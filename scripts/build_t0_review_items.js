const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE = path.resolve(
  ROOT,
  "..",
  "AI_god",
  ".worktrees",
  "jh-all-subject-kg",
  "data",
  "curriculum",
  "output",
);
const SOURCE_DIR = process.env.T0_CURRICULUM_OUTPUT_DIR || DEFAULT_SOURCE;
const RAW_DIR = path.resolve(SOURCE_DIR, "..", "raw");
const SOURCE_LABEL =
  process.env.T0_CURRICULUM_SOURCE_LABEL ||
  "AI_god/.worktrees/jh-all-subject-kg/data/curriculum/output";

const LEVELS = {
  elementary: {
    label: "國小",
    gradeBands: ["國小低", "國小中", "國小高"],
    sampleEvery: 12,
  },
  junior_high: {
    label: "國中",
    gradeBands: ["國中"],
    sampleEvery: 12,
  },
  senior_high: {
    label: "高中",
    gradeBands: ["高中"],
    sampleEvery: 12,
  },
};

const SUBJECTS = {
  chinese: { source: "chinese", label: "國文" },
  english: { source: "english", label: "英文" },
  math: { source: "math", label: "數學" },
  science: { source: "science", label: "自然" },
  social: { source: "shehui", label: "社會" },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  if (!fs.existsSync(file)) return "";
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+\d+\s+學習階段\s+(學習表現|學習內容).+$/u, "")
    .trim();
}

function loadRows(subjectId) {
  const subject = SUBJECTS[subjectId];
  return readJson(path.join(SOURCE_DIR, `${subject.source}_indicators.json`));
}

function rowsFor(levelId, subjectId) {
  const bands = new Set(LEVELS[levelId].gradeBands);
  return loadRows(subjectId).filter((row) => bands.has(row.grade_band));
}

function sourceSha(subjectId) {
  return sha256File(path.join(RAW_DIR, `${SUBJECTS[subjectId].source}.pdf`));
}

function sourceKind(row) {
  return String(row.indicator_type || "").includes("學習內容")
    ? "curriculum_content"
    : "learning_performance";
}

function anomalyFlags(row) {
  const flags = [];
  const code = String(row.code || "");
  const description = cleanText(row.description);
  const excerpt = cleanText(row.raw_match || row.description);
  if (!code) flags.push("missing_code");
  if (description.length < 8) flags.push("short_description");
  if (description.length > 500) flags.push("long_description");
  if (!row.source_page) flags.push("missing_source_page");
  if (!excerpt) flags.push("missing_source_excerpt");
  else if (code && !excerpt.includes(code)) flags.push("excerpt_code_mismatch");
  if (!row.domain) flags.push("missing_domain");
  return flags;
}

function samplingReason(index, flags, sampleEvery) {
  if (flags.length) return `anomaly:${flags.join(",")}`;
  if (index === 1) return "first_item_per_subject_level";
  if (index % sampleEvery === 0) return `deterministic_${sampleEvery}th_sample`;
  return "";
}

function t0Id(levelId, subjectId, code, index) {
  return `t0:${levelId}:${subjectId}:${code}:${String(index).padStart(3, "0")}`;
}

function reviewId(levelId, subjectId, code, index) {
  return `review:${levelId}:${subjectId}:${code}:${index}`;
}

function buildItem(levelId, subjectId, row, index, reason) {
  const code = String(row.code || `row-${index}`);
  const description = cleanText(row.description);
  const excerpt = cleanText(row.raw_match || row.description);
  return {
    review_id: reviewId(levelId, subjectId, code, index),
    t0_id: t0Id(levelId, subjectId, code, index),
    level_id: levelId,
    level: LEVELS[levelId].label,
    subject_id: subjectId,
    subject: SUBJECTS[subjectId].label,
    code,
    indicator_type: row.indicator_type || "",
    source_kind: sourceKind(row),
    domain: row.domain || "",
    sub_domain: row.sub_domain || null,
    description,
    source_page: row.source_page || "",
    source_excerpt: excerpt,
    source_pdf_sha256: sourceSha(subjectId),
    sampling_reason: reason,
    validation_status: "needs_human_review",
    review_status: "pending",
    teacher_decision: "",
    teacher_note: "",
  };
}

function buildAll() {
  const items = [];
  const summary = {};
  for (const levelId of Object.keys(LEVELS)) {
    summary[levelId] = {};
    for (const subjectId of Object.keys(SUBJECTS)) {
      const rows = rowsFor(levelId, subjectId);
      let sampled = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const index = i + 1;
        const flags = anomalyFlags(row);
        const reason = samplingReason(index, flags, LEVELS[levelId].sampleEvery);
        if (!reason) continue;
        items.push(buildItem(levelId, subjectId, row, index, reason));
        sampled += 1;
      }
      if (rows.length === 0) {
        items.push({
          review_id: `review:${levelId}:${subjectId}:missing-source`,
          t0_id: `t0:${levelId}:${subjectId}:missing-source`,
          level_id: levelId,
          level: LEVELS[levelId].label,
          subject_id: subjectId,
          subject: SUBJECTS[subjectId].label,
          code: "MISSING_SOURCE_ROWS",
          indicator_type: "source_gap",
          source_kind: "learning_performance",
          domain: "",
          sub_domain: "",
          description: "此學段科目的 parsed curriculum indicators 目前沒有來源列，需確認 parser 或官方 PDF 結構。",
          source_page: "",
          source_excerpt: "",
          source_pdf_sha256: sourceSha(subjectId),
          sampling_reason: "source_gap",
          validation_status: "needs_human_review",
          review_status: "pending",
          teacher_decision: "",
          teacher_note: "",
        });
        sampled += 1;
      }
      summary[levelId][subjectId] = { source_rows: rows.length, review_items: sampled };
    }
  }
  return { items, summary };
}

function main() {
  const { items, summary } = buildAll();
  const payload = {
    metadata: {
      generated_at: new Date().toISOString(),
      item_count: items.length,
      truth_status: "sample_review_queue",
      source_dir: SOURCE_LABEL,
      levels: Object.fromEntries(
        Object.entries(summary).map(([levelId, subjects]) => [
          levelId,
          {
            source_rows: Object.values(subjects).reduce((sum, v) => sum + v.source_rows, 0),
            review_items: Object.values(subjects).reduce((sum, v) => sum + v.review_items, 0),
            subjects,
          },
        ]),
      ),
    },
    items,
  };
  const out = path.join(ROOT, "public", "t0_review_items.json");
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload.metadata, null, 2));
}

main();
