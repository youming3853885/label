"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type TabKey = "kg" | "t0" | "upad12" | "system" | "feedback";
type Decision = "approved" | "rejected" | "revised";
type QueueStatus = "all" | "pending" | "approved" | "rejected" | "revised";
type SourceFilter = "all" | "concept3" | "quick";
type LevelFilter = "all" | "elementary" | "junior_high" | "senior_high" | "uncategorized";
type SubjectFilter = "all" | "math" | "chinese" | "english" | "science" | "social" | "uncategorized";

type Upad12ReviewRow = {
  id: string;
  knowledge_unit_id: string | null;
  provider: string;
  source_area: string;
  external_code: string;
  external_label: string;
  external_path: string[] | null;
  match_method: string;
  confidence: number | null;
  evidence: Record<string, unknown> | null;
  alignment_review_status: string;
  approved_count: number;
  rejected_count: number;
  revised_count: number;
  review_count: number;
  last_reviewed_at: string | null;
  teacher_review_status: "pending" | "approved" | "rejected" | "revised";
};

const T0_REVIEW_URL =
  process.env.NEXT_PUBLIC_T0_REVIEW_URL ?? "/t0_review.html?bust=20260510clean";

const SHARED_EMAIL = "annotator@label.local";
const REVIEWER_STORAGE_KEY = "label.upad12.reviewerName";
const REVIEW_PAGE_SIZE = 1000;

const tabs = [
  {
    key: "kg" as const,
    label: "知識圖譜說明",
    eyebrow: "KG",
    description: "給非技術會議使用的一圖式說明。",
  },
  {
    key: "t0" as const,
    label: "T0 課綱審查",
    eyebrow: "T0",
    description: "抽樣審查、同步決策、匯出 CSV / JSON。",
  },
  {
    key: "upad12" as const,
    label: "知識點 教師審核",
    eyebrow: "POINTS",
    description: "審查下載回來的全科知識點是否可作為 KG 參考證據。",
  },
] as const;

// 放在側欄最下方（不在上面那組）：問途系統總覽。
const SYSTEM_TAB = {
  key: "system" as const,
  label: "問途系統總覽",
  eyebrow: "WENTU",
  description: "問途各角色目前已上線的功能 + 測試用 admin 帳號。",
};

// 內測意見回饋（讓問途內測人員回報遇到的問題、Bug、建議）。
const FEEDBACK_TAB = {
  key: "feedback" as const,
  label: "內測意見回饋",
  eyebrow: "FEEDBACK",
  description: "回報你在問途使用中遇到的問題、Bug 或建議，會直接進到 admin 後台。",
};

const WENTU_URL = "https://study.ezai.today";

// 問途各角色「已上線」功能（給非技術夥伴看的總覽）。
const WENTU_ROLES: { role: string; eyebrow: string; color: string; features: string[] }[] = [
  {
    role: "學生",
    eyebrow: "STUDENT",
    color: "bg-[#d6f3f1] border-[#8ecfca]",
    features: [
      "AI 家教蘇格拉底式引導解題（依國小/國中/高中學段自動調整用語）",
      "拍照上傳題目（OCR 辨識，數學自動排版）",
      "互動視覺化：把題目畫成可拖動參數的數學圖",
      "解題對話可中途停止 / 換一題",
      "真人老師解題（500 銀幣，24 小時內回覆）",
      "弱點練習與「我的弱點」報告、歷史紀錄",
      "解題結束滿意度回饋；銀幣錢包與兌換碼",
    ],
  },
  {
    role: "補習班（負責人）",
    eyebrow: "CRAM SCHOOL",
    color: "bg-[#ffe6b8] border-[#e7bd6a]",
    features: [
      "班級管理 + 學生 Excel / CSV 匯入",
      "出勤 QR 打卡 + LINE 即時通知家長",
      "學費收款（綠界 / 手動匯款）與電子發票",
      "銀幣共用池 + 加購銀幣包（藍新金流：信用卡 / ATM）",
      "LINE 自動回覆 + FAQ 知識庫",
      "家長週報、滿意度問卷、催費、續班管理",
      "一個帳號可管理多間補習班並切換",
    ],
  },
  {
    role: "系統管理員（admin）",
    eyebrow: "ADMIN",
    color: "bg-[#ffe0dc] border-[#e9a39a]",
    features: [
      "用戶管理：搜尋 / 停權 / 解除停權 / 直接加幣",
      "真人解題審核佇列 + 老師分潤結算",
      "好題待審入庫、視覺化失敗回報處理",
      "知識圖譜（prerequisite 邊）審核",
      "兌換碼產生、批次發幣",
      "儀表板：使用量 / 新增用戶 / 月營收 / 解題滿意度",
      "Token 流水、濫用紀錄、考卷管理",
    ],
  },
  {
    role: "解題老師",
    eyebrow: "SOLVER",
    color: "bg-[#d9f5df] border-[#95d6a2]",
    features: [
      "帳號由 admin 建立指派（不開放自助申請）",
      "接收學生的真人解題題目並線上作答",
      "完整解題流程（含多模態看圖）",
      "每題固定 NT$50 分潤",
    ],
  },
];

const flow = [
  {
    title: "官方課綱",
    text: "先確認教育部課綱寫了什麼，這是知識圖譜的根。",
    color: "bg-[#d6f3f1] border-[#8ecfca]",
  },
  {
    title: "知識點",
    text: "把課綱轉成老師看得懂的單元、概念與技能。",
    color: "bg-[#ffe6b8] border-[#e7bd6a]",
  },
  {
    title: "外部資料",
    text: "UPAD12、題庫與教材只當參考證據，不直接變成正式知識。",
    color: "bg-paper border-ink shadow-[0_0_0_2px_rgba(26,26,26,0.08)]",
  },
  {
    title: "教師審核",
    text: "老師確認後，資料才可進入正式流程。",
    color: "bg-[#d9f5df] border-[#95d6a2]",
  },
  {
    title: "應用",
    text: "用在出題、弱點診斷、教材推薦與補救路徑。",
    color: "bg-[#ffe0dc] border-[#e9a39a]",
  },
];

const outcomes = [
  ["出題", "知道題目要考哪個知識點，避免亂出或重複出。"],
  ["診斷", "學生錯題可以回到具體知識點，而不是只看到章節名稱。"],
  ["補救", "找出缺口後，能推薦前置概念與練習順序。"],
  ["管理", "讓課綱、教材、題庫與教師審核都有可追溯紀錄。"],
];

export default function ReviewPortalPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("kg");
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const active = useMemo(
    () =>
      [...tabs, SYSTEM_TAB, FEEDBACK_TAB].find((tab) => tab.key === activeTab) ??
      tabs[0],
    [activeTab],
  );

  useEffect(() => {
    const sb = supabase();
    sb.auth.getUser().then(({ data }) => {
      const u = data.user;
      setUser(u ? { id: u.id, email: u.email ?? undefined } : null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email ?? undefined } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return <Centered>載入中...</Centered>;
  }

  if (!user) {
    return <LoginCard />;
  }

  return (
    <main className="min-h-screen bg-[#f4f0e7] text-ink">
      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-rule bg-[#151b1a] p-5 text-paper lg:border-b-0 lg:border-r lg:border-black/20">
          <div className="mb-8">
            <div className="serif text-[24px] font-semibold">label</div>
            <p className="mt-1 text-[12px] leading-5 text-paper/55">
              講義審核與知識圖譜入口
            </p>
          </div>

          <nav className="space-y-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={
                  "w-full rounded-md border px-3 py-3 text-left transition " +
                  (activeTab === tab.key
                    ? "border-paper/25 bg-paper text-ink"
                    : "border-paper/10 bg-white/5 text-paper/78 hover:bg-white/10")
                }
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">
                  {tab.eyebrow}
                </div>
                <div className="mt-1 text-[15px] font-semibold">{tab.label}</div>
                <p className="mt-1 text-[12px] leading-5 opacity-70">{tab.description}</p>
              </button>
            ))}

            <a
              href="/label?mode=practice"
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-paper/10 bg-white/5 px-3 py-3 text-paper/78 transition hover:bg-white/10"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">
                PRACTICE
              </div>
              <div className="mt-1 text-[15px] font-semibold">實力驗收</div>
              <p className="mt-1 text-[12px] leading-5 opacity-70">
                開啟新分頁校稿實力驗收 PDF。
              </p>
            </a>

            <a
              href="/label"
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-paper/10 bg-white/5 px-3 py-3 text-paper/78 transition hover:bg-white/10"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">
                LABEL
              </div>
              <div className="mt-1 text-[15px] font-semibold">講義標註</div>
              <p className="mt-1 text-[12px] leading-5 opacity-70">
                開啟新分頁進入講義框選與標註。
              </p>
            </a>

            <button
              onClick={() => setActiveTab("system")}
              className={
                "w-full rounded-md border px-3 py-3 text-left transition " +
                (activeTab === "system"
                  ? "border-paper/25 bg-paper text-ink"
                  : "border-paper/10 bg-white/5 text-paper/78 hover:bg-white/10")
              }
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">
                {SYSTEM_TAB.eyebrow}
              </div>
              <div className="mt-1 text-[15px] font-semibold">{SYSTEM_TAB.label}</div>
              <p className="mt-1 text-[12px] leading-5 opacity-70">
                問途各角色已上線功能 + 測試帳號。
              </p>
            </button>

            <button
              onClick={() => setActiveTab("feedback")}
              className={
                "w-full rounded-md border px-3 py-3 text-left transition " +
                (activeTab === "feedback"
                  ? "border-paper/25 bg-paper text-ink"
                  : "border-paper/10 bg-white/5 text-paper/78 hover:bg-white/10")
              }
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">
                {FEEDBACK_TAB.eyebrow}
              </div>
              <div className="mt-1 text-[15px] font-semibold">{FEEDBACK_TAB.label}</div>
              <p className="mt-1 text-[12px] leading-5 opacity-70">
                回報問題、Bug、建議；直接進到 admin 後台。
              </p>
            </button>

            <a
              href={WENTU_URL}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-paper/10 bg-white/5 px-3 py-3 text-paper/78 transition hover:bg-white/10"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">
                GO
              </div>
              <div className="mt-1 text-[15px] font-semibold">前往問途 ↗</div>
              <p className="mt-1 text-[12px] leading-5 opacity-70">
                開啟新分頁連到問途網站。
              </p>
            </a>
          </nav>
        </aside>

        <section className="min-w-0">
          <header className="flex min-h-16 flex-col gap-2 border-b border-rule bg-paper px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-accent">
                {active.eyebrow}
              </p>
              <h1 className="serif text-[28px] font-semibold">{active.label}</h1>
            </div>
            <div className="max-w-xl text-[13px] leading-6 text-ink-3">{active.description}</div>
          </header>

          {activeTab === "kg" && <KnowledgeGraphTab />}
          {activeTab === "t0" && <T0ReviewTab />}
          {activeTab === "upad12" && <Upad12ReviewTab userEmail={user.email} />}
          {activeTab === "system" && <SystemOverviewTab />}
          {activeTab === "feedback" && <FeedbackTab userId={user.id} />}
        </section>
      </div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper text-ink-3">
      {children}
    </div>
  );
}

function LoginCard() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase().auth.signInWithPassword({
      email: SHARED_EMAIL,
      password: password.trim(),
    });
    setBusy(false);
    if (error) {
      setMsg("密碼不正確，請重新確認。");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="serif mb-1 text-[28px] font-semibold">label 審核入口</div>
        <p className="mb-6 text-[13.5px] leading-7 text-ink-3">
          請輸入共用審核密碼。登入後可進行 T0 課綱審查、UPAD12 教師審核與講義標註。
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && password.trim() && submit()}
          placeholder="審核密碼"
          autoFocus
          className="h-11 w-full rounded-md border border-rule-2 px-3 text-[14px] tracking-widest"
        />
        <button
          onClick={submit}
          disabled={busy || !password.trim()}
          className="mt-3 h-11 w-full rounded-md bg-ink text-[14px] text-paper disabled:opacity-50"
        >
          {busy ? "登入中..." : "進入"}
        </button>
        {msg && <p className="mt-3 text-[12.5px] text-danger">{msg}</p>}
      </div>
    </main>
  );
}

function SystemOverviewTab() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 space-y-6">
      {/* 測試用 admin 帳號 */}
      <div className="rounded-md border border-accent/30 bg-accent-soft p-5">
        <div className="text-[12px] font-bold tracking-[0.18em] text-accent">測試用 ADMIN 帳號</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[11px] text-ink-3">登入網址</div>
            <a
              href={`${WENTU_URL}/login`}
              target="_blank"
              rel="noreferrer"
              className="text-[14px] font-medium text-accent underline break-all"
            >
              {WENTU_URL}/login ↗
            </a>
          </div>
          <div>
            <div className="text-[11px] text-ink-3">Email</div>
            <div className="text-[15px] font-mono font-semibold text-ink">admin@test.com</div>
          </div>
          <div>
            <div className="text-[11px] text-ink-3">密碼</div>
            <div className="text-[15px] font-mono font-semibold text-ink">12341234</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-6 text-ink-3">
          僅供內部測試展示，請勿用於正式資料。
        </p>
      </div>

      {/* 四個角色已上線功能 */}
      <div className="grid gap-4 md:grid-cols-2">
        {WENTU_ROLES.map((r) => (
          <div key={r.role} className={`rounded-md border p-5 ${r.color}`}>
            <div className="text-[12px] font-bold tracking-[0.18em] text-ink/60">{r.eyebrow}</div>
            <h3 className="mt-1 text-[22px] font-semibold text-ink">{r.role}</h3>
            <ul className="mt-3 space-y-2">
              {r.features.map((f, i) => (
                <li key={i} className="flex gap-2 text-[14px] leading-7 text-ink-2">
                  <span className="mt-[2px] shrink-0 text-ink/50">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────── 內測意見回饋表單 ────────────────────────────

type FeedbackCategory = "bug" | "feature" | "question" | "other";
type FeedbackSeverity = "" | "urgent" | "normal" | "low";

const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug（功能壞掉、出錯）" },
  { value: "feature", label: "功能建議" },
  { value: "question", label: "操作疑問" },
  { value: "other", label: "其他" },
];

const FEEDBACK_SEVERITIES: { value: FeedbackSeverity; label: string }[] = [
  { value: "", label: "不指定" },
  { value: "urgent", label: "很急（影響使用）" },
  { value: "normal", label: "普通" },
  { value: "low", label: "不急（建議改進）" },
];

const FEEDBACK_BUCKET = "feedback-screenshots";
const FEEDBACK_REPORTER_KEY = "label.feedback.reporterName";

interface PendingShot {
  id: string;
  file: File;
  previewUrl: string;
}

function FeedbackTab({ userId }: { userId: string }) {
  const [reporterName, setReporterName] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [severity, setSeverity] = useState<FeedbackSeverity>("");
  const [description, setDescription] = useState("");
  const [pageUrl, setPageUrl] = useState("https://study.ezai.today/");
  const [shots, setShots] = useState<PendingShot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successAt, setSuccessAt] = useState<number | null>(null);

  // 名字記在 localStorage，下次自動帶入。
  useEffect(() => {
    setReporterName(localStorage.getItem(FEEDBACK_REPORTER_KEY) ?? "");
  }, []);
  useEffect(() => {
    if (reporterName.trim()) {
      localStorage.setItem(FEEDBACK_REPORTER_KEY, reporterName.trim());
    }
  }, [reporterName]);

  // 卸載時清掉預覽 URL，避免漏記憶體。
  useEffect(() => {
    return () => {
      shots.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
  }, [shots]);

  function addFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg("單張截圖最大 5 MB，請壓縮後再貼。");
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setShots((prev) => [...prev, { id, file, previewUrl: URL.createObjectURL(file) }]);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    let handled = false;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          addFile(file);
          handled = true;
        }
      }
    }
    if (handled) e.preventDefault();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    Array.from(e.dataTransfer.files ?? []).forEach(addFile);
  }

  function removeShot(id: string) {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  }

  async function submit() {
    setErrorMsg(null);
    if (!reporterName.trim()) {
      setErrorMsg("請填寫你的名字。");
      return;
    }
    if (!description.trim()) {
      setErrorMsg("請描述遇到的狀況。");
      return;
    }
    setSubmitting(true);
    try {
      const client = supabase();
      const uploadedPaths: string[] = [];
      for (const s of shots) {
        const ext = (s.file.name.split(".").pop() || "png").toLowerCase().slice(0, 5);
        const key = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await client.storage
          .from(FEEDBACK_BUCKET)
          .upload(key, s.file, { contentType: s.file.type, upsert: false });
        if (upErr) throw upErr;
        uploadedPaths.push(key);
      }

      const { error: insertErr } = await client.from("feedback_reports").insert({
        reporter_name: reporterName.trim(),
        reporter_uid: userId,
        category,
        severity: severity || null,
        description: description.trim(),
        page_url: pageUrl.trim() || null,
        screenshot_paths: uploadedPaths,
      });
      if (insertErr) throw insertErr;

      // 清空表單，但保留名字。
      shots.forEach((s) => URL.revokeObjectURL(s.previewUrl));
      setShots([]);
      setDescription("");
      setSeverity("");
      setCategory("bug");
      setPageUrl("https://study.ezai.today/");
      setSuccessAt(Date.now());
      window.setTimeout(() => setSuccessAt(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "送出失敗，請稍後再試。";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 space-y-5">
      <div className="rounded-md border border-rule bg-[#fffdf8] p-4 text-[13px] leading-7 text-ink-2">
        在問途任何頁面遇到問題、想到建議、看到 Bug，都歡迎在這裡回報。
        資料會直接進到 admin 後台，由團隊處理。
      </div>

      {successAt && (
        <div className="rounded-md border border-good/30 bg-good/10 px-4 py-3 text-[13px] text-good">
          已收到，謝謝你的回報！
        </div>
      )}

      {errorMsg && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
          {errorMsg}
        </div>
      )}

      <div className="space-y-4 rounded-md border border-rule bg-paper p-5 shadow-[0_12px_34px_rgba(28,37,34,.06)]">
        <Field label="你的名字" required>
          <input
            value={reporterName}
            onChange={(e) => setReporterName(e.target.value)}
            placeholder="例：王老師"
            className="h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="問題類別" required>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              className="h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
            >
              {FEEDBACK_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="嚴重程度">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)}
              className="h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
            >
              {FEEDBACK_SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="詳細描述（可直接 Ctrl+V 貼上截圖）" required>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="rounded-md border border-rule-2 bg-white"
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={handlePaste}
              placeholder="請描述發生什麼事、步驟、預期結果與實際結果。截圖可直接 Ctrl+V 貼進來。"
              className="min-h-40 w-full resize-y rounded-t-md bg-transparent p-3 text-[14px] leading-7 outline-none"
            />
            {shots.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-rule-2 bg-[#fbfaf6] p-2">
                {shots.map((s) => (
                  <div
                    key={s.id}
                    className="relative overflow-hidden rounded border border-rule bg-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.previewUrl}
                      alt="截圖預覽"
                      className="block max-h-28"
                    />
                    <button
                      type="button"
                      onClick={() => removeShot(s.id)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-paper hover:bg-black/80"
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1 text-[11.5px] text-ink-3">
            支援 PNG / JPG / WebP / GIF，單張最大 5 MB；也可拖檔進來。
          </p>
        </Field>

        <Field label="發生在哪個頁面 URL">
          <input
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            placeholder="https://study.ezai.today/..."
            className="h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <button
            onClick={() => {
              shots.forEach((s) => URL.revokeObjectURL(s.previewUrl));
              setShots([]);
              setDescription("");
              setSeverity("");
              setCategory("bug");
              setPageUrl("https://study.ezai.today/");
            }}
            disabled={submitting}
            className="h-10 rounded-md border border-rule-2 bg-white px-4 text-[13px] text-ink-2 disabled:opacity-50"
          >
            清空
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="h-10 rounded-md border border-ink bg-ink px-5 text-[13px] font-semibold text-paper disabled:opacity-50"
          >
            {submitting ? "送出中..." : "送出回報"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[12.5px] font-semibold text-ink-2">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </div>
      {children}
    </label>
  );
}

function KnowledgeGraphTab() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="rounded-md border border-rule bg-paper p-6 shadow-[0_22px_70px_rgba(28,37,34,.08)]">
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex rounded-full border border-accent/25 bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent">
            會議用一圖式說明
          </span>
          <h2 className="serif mt-5 text-[42px] font-semibold leading-tight md:text-[56px]">
            知識圖譜就是把課綱、教材、題庫串成可追溯流程
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-[16px] leading-8 text-ink-2">
            它不是讓 AI 自己發明知識，而是先把官方課綱整理清楚，再把教材與題庫對齊上去，
            最後由老師審核，讓出題、診斷與補救都有依據。
          </p>
        </div>

        <div className="mt-8 grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] xl:items-stretch">
          {flow.map((item, index) => (
            <div key={item.title} className="contents">
              <div className={`rounded-md border p-5 ${item.color}`}>
                <div className="text-[12px] font-bold tracking-[0.18em] text-accent">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <h3 className="mt-5 text-[21px] font-semibold">{item.title}</h3>
                <p className="mt-3 text-[14px] leading-7 text-ink-2">{item.text}</p>
              </div>
              {index < flow.length - 1 && (
                <div className="flex items-center justify-center text-[26px] text-ink-4">
                  <span className="hidden xl:inline">→</span>
                  <span className="xl:hidden">↓</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            "官方課綱是根，不讓外部資料反客為主。",
            "UPAD12 只當外部覆蓋度與命題範圍參考。",
            "老師審核通過後，才可進正式知識圖譜流程。",
            "每筆資料都能追溯到來源、審核人與決策。"].
            map((point) => (
              <div key={point} className="rounded-md border border-rule bg-[#fffdf8] p-4">
                <div className="mb-2 h-2 w-2 rounded-full bg-good" />
                <p className="text-[14px] font-medium leading-6 text-ink-2">{point}</p>
              </div>
            ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {outcomes.map(([title, text]) => (
          <div key={title} className="rounded-md border border-rule bg-paper p-5">
            <h3 className="text-[20px] font-semibold">{title}</h3>
            <p className="mt-2 text-[14px] leading-7 text-ink-2">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function T0ReviewTab() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const sendSessionToFrame = useCallback(async () => {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    const { data } = await supabase().auth.getSession();
    frame.postMessage(
      { type: "label-supabase-session", session: data.session },
      window.location.origin,
    );
  }, []);

  useEffect(() => {
    sendSessionToFrame();
    const { data } = supabase().auth.onAuthStateChange(() => {
      void sendSessionToFrame();
    });
    return () => data.subscription.unsubscribe();
  }, [sendSessionToFrame]);

  return (
    <div className="flex h-[calc(100vh-65px)] flex-col">
      <div className="flex flex-col gap-3 border-b border-rule bg-[#fffdf8] px-5 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-good/30 bg-good/10 px-2.5 py-1 text-[12px] font-semibold text-good">
              同步審核
            </span>
            <span className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">
              匯出 JSON
            </span>
            <span className="rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[12px] font-semibold text-warn">
              匯出 CSV
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">
            T0 是官方課綱資料，正式匯入前必須先有教師人工審核紀錄。
          </p>
        </div>
      </div>
      <iframe
        ref={frameRef}
        title="T0 課綱抽樣審查工作台"
        src={T0_REVIEW_URL}
        onLoad={sendSessionToFrame}
        className="h-full w-full flex-1 border-0"
      />
    </div>
  );
}

function Upad12ReviewTab({ userEmail }: { userEmail?: string }) {
  const [rows, setRows] = useState<Upad12ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [globalTotal, setGlobalTotal] = useState<number | null>(null);
  const [globalReviewedTotal, setGlobalReviewedTotal] = useState<number | null>(null);
  const [statusCounts, setStatusCounts] = useState<{ approved: number; rejected: number; revised: number } | null>(null);
  const [hasMoreRows, setHasMoreRows] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceFilter>("all");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [subject, setSubject] = useState<SubjectFilter>("all");
  const [status, setStatus] = useState<QueueStatus>("pending");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewerName, setReviewerName] = useState("");
  const loadRunRef = useRef(0);
  const autoLoadKeyRef = useRef("");

  useEffect(() => {
    setReviewerName(localStorage.getItem(REVIEWER_STORAGE_KEY) ?? "");
  }, []);

  useEffect(() => {
    if (reviewerName.trim()) {
      localStorage.setItem(REVIEWER_STORAGE_KEY, reviewerName.trim());
    }
  }, [reviewerName]);

  const loadGlobalTotal = useCallback(async () => {
    const { count, error: countError } = await supabase()
      .from("v_upad12_teacher_review_queue")
      .select("id", { count: "exact", head: true });
    if (!countError) {
      setGlobalTotal(count ?? 0);
    }
  }, []);

  const loadGlobalReviewedTotal = useCallback(async () => {
    const { count, error: countError } = await supabase()
      .from("v_upad12_teacher_review_queue")
      .select("id", { count: "exact", head: true })
      .neq("teacher_review_status", "pending");
    if (!countError) {
      setGlobalReviewedTotal(count ?? 0);
    }
  }, []);

  const loadStatusCounts = useCallback(async () => {
    const statuses = ["approved", "rejected", "revised"] as const;
    const results = await Promise.all(
      statuses.map(async (s) => {
        const { count, error: countError } = await supabase()
          .from("v_upad12_teacher_review_queue")
          .select("id", { count: "exact", head: true })
          .eq("teacher_review_status", s);
        return countError ? null : count ?? 0;
      }),
    );
    if (results.every((value) => value !== null)) {
      setStatusCounts({
        approved: results[0] as number,
        rejected: results[1] as number,
        revised: results[2] as number,
      });
    }
  }, []);

  const loadRows = useCallback(async (append = false, offset = 0) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    const runId = append ? loadRunRef.current : loadRunRef.current + 1;
    if (!append) {
      loadRunRef.current = runId;
      autoLoadKeyRef.current = "";
    }

    const from = append ? offset : 0;
    let query = supabase()
      .from("v_upad12_teacher_review_queue")
      .select("*", { count: append ? undefined : "planned" })
      .order("confidence", { ascending: false })
      .range(from, from + REVIEW_PAGE_SIZE - 1);

    if (source !== "all") query = query.eq("source_area", source);
    if (status !== "all") query = query.eq("teacher_review_status", status);

    const { data, count, error: loadError } = await query;
    if (runId !== loadRunRef.current) return;

    if (loadError) {
      setError(loadError.message);
      if (!append) setRows([]);
    } else {
      const nextRows = (data ?? []) as Upad12ReviewRow[];
      setRows((current) => (append ? [...current, ...nextRows] : nextRows));
      if (!append) setServerTotal(count ?? null);
      setHasMoreRows(nextRows.length === REVIEW_PAGE_SIZE);
    }
    if (append) setLoadingMore(false);
    else setLoading(false);
  }, [source, status]);

  const loadRemainingRows = useCallback(async (offset: number) => {
    if (loadingAll) return;
    setLoadingAll(true);
    setError(null);
    const runId = loadRunRef.current;
    let nextOffset = offset;
    let more = true;

    while (more && runId === loadRunRef.current) {
      let query = supabase()
        .from("v_upad12_teacher_review_queue")
        .select("*")
        .order("confidence", { ascending: false })
        .range(nextOffset, nextOffset + REVIEW_PAGE_SIZE - 1);

      if (source !== "all") query = query.eq("source_area", source);
      if (status !== "all") query = query.eq("teacher_review_status", status);

      const { data, error: loadError } = await query;
      if (runId !== loadRunRef.current) break;

      if (loadError) {
        setError(loadError.message);
        break;
      }

      const nextRows = (data ?? []) as Upad12ReviewRow[];
      if (nextRows.length === 0) {
        more = false;
        setHasMoreRows(false);
        break;
      }

      setRows((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...nextRows.filter((row) => !seen.has(row.id))];
      });
      nextOffset += nextRows.length;
      more = nextRows.length === REVIEW_PAGE_SIZE;
      setHasMoreRows(more);

      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }

    if (runId === loadRunRef.current) setLoadingAll(false);
  }, [loadingAll, source, status]);

  useEffect(() => {
    void loadRows();
    void loadGlobalTotal();
    void loadGlobalReviewedTotal();
    void loadStatusCounts();
  }, [loadRows, loadGlobalTotal, loadGlobalReviewedTotal, loadStatusCounts]);

  useEffect(() => {
    if (loading || loadingAll || !hasMoreRows || rows.length === 0) return;
    const key = `${source}:${status}`;
    if (autoLoadKeyRef.current === key) return;
    autoLoadKeyRef.current = key;
    const timer = window.setTimeout(() => {
      void loadRemainingRows(rows.length);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hasMoreRows, loading, loadingAll, loadRemainingRows, rows.length, source, status]);

  useEffect(() => {
    const channel = supabase()
      .channel("upad12-review-decisions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upad12_teacher_review_decisions" },
        () => {
          void loadRows(false);
          void loadGlobalReviewedTotal();
        },
      )
      .subscribe();
    return () => {
      void supabase().removeChannel(channel);
    };
  }, [loadRows, loadGlobalReviewedTotal]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (level !== "all" && inferLevel(row) !== level) {
        return false;
      }
      if (subject !== "all" && inferSubject(row) !== subject) {
        return false;
      }
      if (status !== "all" && row.teacher_review_status !== status) {
        return false;
      }
      if (!keyword) return true;
      const haystack = [
        row.external_label,
        row.external_code,
        row.knowledge_unit_id ?? "",
        toDisplay(row.evidence?.knowledge_unit_label),
        toDisplay(row.evidence?.ku_content_titles),
        row.match_method,
        row.source_area,
        levelLabel(inferLevel(row)),
        subjectLabel(inferSubject(row)),
        ...(row.external_path ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [rows, level, search, subject, status]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [source, level, subject, status, search]);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setCurrentIndex(0);
      return;
    }
    setCurrentIndex((index) => Math.min(index, filteredRows.length - 1));
  }, [filteredRows.length]);

  const currentRow = filteredRows[currentIndex] ?? null;

  const summary = useMemo(() => {
    const base = rows.reduce(
      (acc, row) => {
        const rowLevel = inferLevel(row);
        const rowSubject = inferSubject(row);
        acc.total += 1;
        acc[row.teacher_review_status] += 1;
        if (row.source_area === "quick") acc.quick += 1;
        if (row.source_area === "concept3") acc.concept3 += 1;
        if (subject === "all" || rowSubject === subject) {
          acc.levels[rowLevel] += 1;
        }
        if (level === "all" || rowLevel === level) {
          acc.subjects[rowSubject] += 1;
        }
        return acc;
      },
      {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        revised: 0,
        quick: 0,
        concept3: 0,
        levels: {
          all: 0,
          elementary: 0,
          junior_high: 0,
          senior_high: 0,
          uncategorized: 0,
        } as Record<LevelFilter, number>,
        subjects: {
          all: 0,
          math: 0,
          chinese: 0,
          english: 0,
          science: 0,
          social: 0,
          uncategorized: 0,
        } as Record<SubjectFilter, number>,
      },
    );
    base.total = Math.max(serverTotal ?? 0, rows.length, base.total);
    return base;
  }, [level, rows, serverTotal, subject]);

  // 審查狀態各選項的「資料庫真實筆數」（與目前篩選無關，全部精確計數）
  const statusOptionCounts = useMemo(() => {
    if (statusCounts == null || globalTotal == null) return null;
    const reviewed = statusCounts.approved + statusCounts.rejected + statusCounts.revised;
    return {
      pending: Math.max(0, globalTotal - reviewed),
      approved: statusCounts.approved,
      rejected: statusCounts.rejected,
      revised: statusCounts.revised,
      all: globalTotal,
    };
  }, [statusCounts, globalTotal]);

  const statusCountSuffix = (key: "pending" | "approved" | "rejected" | "revised" | "all") =>
    statusOptionCounts ? ` (${statusOptionCounts[key]})` : "";

  const decide = async (row: Upad12ReviewRow, decision: Decision) => {
    setSavingId(row.id);
    setError(null);
    const { data } = await supabase().auth.getUser();
    const user = data.user;
    if (!user) {
      setError("登入狀態已失效，請重新登入。");
      setSavingId(null);
      return;
    }

    const { error: saveError } = await supabase()
      .from("upad12_teacher_review_decisions")
      .upsert(
        {
          alignment_id: row.id,
          decision,
          note: notes[row.id]?.trim() || null,
          reviewer_id: user.id,
          reviewer_name: reviewerName.trim() || userEmail || "教師",
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "alignment_id,reviewer_id" },
      );

    if (saveError) {
      setError(saveError.message);
    } else {
      const nextStatus = decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "revised";
      // 不在前端自己 +1（會越加越不準），改成審完直接跟資料庫要一次精確的「已審查」數字。
      void loadGlobalReviewedTotal();
      void loadStatusCounts();
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                teacher_review_status: nextStatus,
                approved_count: decision === "approved" ? Math.max(1, item.approved_count) : item.approved_count,
                rejected_count: decision === "rejected" ? Math.max(1, item.rejected_count) : item.rejected_count,
                revised_count: decision === "revised" ? Math.max(1, item.revised_count) : item.revised_count,
                review_count: Math.max(1, item.review_count),
                last_reviewed_at: new Date().toISOString(),
              }
            : item,
        ),
      );
      setCurrentIndex((index) => Math.min(index, Math.max(0, filteredRows.length - 2)));
    }
    setSavingId(null);
  };

  return (
    <div className="min-h-[calc(100vh-65px)] bg-[#f4f0e7] bg-[linear-gradient(#e8e0d3_1px,transparent_1px),linear-gradient(90deg,#e8e0d3_1px,transparent_1px)] bg-[size:20px_20px] px-5 py-5">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-md border border-rule bg-paper/95 p-3 shadow-[0_12px_34px_rgba(28,37,34,.06)]">
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="知識點" value={globalTotal ?? summary.total} />
            <StatCard label="已審查" value={globalReviewedTotal ?? summary.approved + summary.rejected + summary.revised} tone="good" />
            <StatCard label="本清單" value={filteredRows.length} tone="warn" />
            <StatCard label="目前筆" value={filteredRows.length ? currentIndex + 1 : 0} />
          </div>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-3">搜尋</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="code / subject / text"
                className="mt-1 h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-3">來源</span>
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as SourceFilter)}
                className="mt-1 h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
              >
                <option value="all">全部</option>
                <option value="quick">快速命題</option>
                <option value="concept3">知識概念</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-3">科目</span>
              <select
                value={subject}
                onChange={(event) => setSubject(event.target.value as SubjectFilter)}
                className="mt-1 h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
              >
                <option value="all">全部</option>
                <option value="math">數學 ({summary.subjects.math})</option>
                <option value="chinese">國文 ({summary.subjects.chinese})</option>
                <option value="english">英文 ({summary.subjects.english})</option>
                <option value="science">自然 ({summary.subjects.science})</option>
                <option value="social">社會 ({summary.subjects.social})</option>
                <option value="uncategorized">未分類 ({summary.subjects.uncategorized})</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-3">學段</span>
              <select
                value={level}
                onChange={(event) => setLevel(event.target.value as LevelFilter)}
                className="mt-1 h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
              >
                <option value="all">全部</option>
                <option value="elementary">國小 ({summary.levels.elementary})</option>
                <option value="junior_high">國中 ({summary.levels.junior_high})</option>
                <option value="senior_high">高中 ({summary.levels.senior_high})</option>
                <option value="uncategorized">未分類 ({summary.levels.uncategorized})</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-3">審查狀態</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as QueueStatus)}
                className="mt-1 h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
              >
                <option value="pending">{`待審${statusCountSuffix("pending")}`}</option>
                <option value="approved">{`通過${statusCountSuffix("approved")}`}</option>
                <option value="rejected">{`退回${statusCountSuffix("rejected")}`}</option>
                <option value="revised">{`需修正${statusCountSuffix("revised")}`}</option>
                <option value="all">{`全部${statusCountSuffix("all")}`}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-3">審核教師</span>
              <input
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                placeholder="請輸入姓名"
                className="mt-1 h-10 w-full rounded-md border border-rule-2 bg-white px-3 text-[14px]"
              />
            </label>
            <button
              onClick={() => {
                void loadRows(false);
                void loadGlobalTotal();
                void loadGlobalReviewedTotal();
                void loadStatusCounts();
              }}
              className="h-10 w-full rounded-md border border-ink bg-ink px-4 text-[14px] font-semibold text-paper"
            >
              同步整理
            </button>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 rounded-md border border-rule bg-[#fffdf8] px-4 py-3 text-[12.5px] leading-6 text-ink-3">
            知識點資料只作為外部參考證據。多人協作時，每位老師按下通過、修正或退回後都會寫入 Supabase，其他人的畫面會透過 Realtime 重新整理。
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
              {error}
            </div>
          )}

          {loading && <div className="rounded-md border border-rule bg-paper p-5 text-ink-3">載入第一批知識點審核清單...</div>}
          {!loading && !currentRow && (
            <div className="rounded-md border border-rule bg-paper p-5 text-ink-3">目前沒有符合條件的知識點。</div>
          )}
          {!loading && currentRow && (
            <Upad12ReviewCard
              key={currentRow.id}
              row={currentRow}
              note={notes[currentRow.id] ?? ""}
              saving={savingId === currentRow.id}
              index={currentIndex}
              total={filteredRows.length}
              onPrev={() => setCurrentIndex((index) => Math.max(0, index - 1))}
              onNext={() => setCurrentIndex((index) => Math.min(filteredRows.length - 1, index + 1))}
              onNoteChange={(value) => setNotes((prev) => ({ ...prev, [currentRow.id]: value }))}
              onDecision={(decision) => void decide(currentRow, decision)}
            />
          )}
          {!loading && hasMoreRows && (
            <div className="mt-3 rounded-md border border-rule bg-paper p-3 text-center">
              <button
                onClick={() => void loadRows(true, rows.length)}
                disabled={loadingMore || loadingAll}
                className="h-10 rounded-md border border-rule-2 bg-white px-5 text-[13px] font-semibold text-ink-2 disabled:opacity-50"
              >
                {loadingAll ? "背景補齊中..." : loadingMore ? "載入中..." : `再載入 ${REVIEW_PAGE_SIZE} 筆`}
              </button>
              <span className="ml-3 text-[12px] text-ink-3">
                已載入 {rows.length} 筆{serverTotal && serverTotal > rows.length ? ` / 約 ${serverTotal} 筆` : ""}
              </span>
            </div>
          )}
          {!loading && loadingAll && (
            <div className="mt-3 rounded-md border border-rule bg-paper/85 p-3 text-center text-[12px] text-ink-3">
              背景載入全部審核清單中，目前已載入 {rows.length} 筆。你可以先繼續審核，不用等待。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn" | "danger" | "accent";
}) {
  const toneClass =
    tone === "good"
      ? "text-good"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : tone === "accent"
            ? "text-accent"
            : "text-ink";
  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <div className="text-[12px] font-semibold text-ink-3">{label}</div>
      <div className={`mt-1 text-[30px] font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function Upad12ReviewCard({
  row,
  note,
  saving,
  index,
  total,
  onPrev,
  onNext,
  onNoteChange,
  onDecision,
}: {
  row: Upad12ReviewRow;
  note: string;
  saving: boolean;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onNoteChange: (value: string) => void;
  onDecision: (decision: Decision) => void;
}) {
  const evidence = row.evidence ?? {};
  const path = row.external_path?.filter(Boolean).join(" / ") || "未提供路徑";
  const confidence = Math.round((row.confidence ?? 0) * 100);

  return (
    <article className="rounded-md border border-rule bg-paper shadow-[0_12px_34px_rgba(28,37,34,.08)]">
      <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={row.teacher_review_status} />
            <span className="rounded-full border border-rule-2 px-2.5 py-1 text-[12px] text-ink-3">
              {sourceLabel(row.source_area)}
            </span>
            <span className="rounded-full border border-rule-2 px-2.5 py-1 text-[12px] text-ink-3">
              {levelLabel(inferLevel(row))}
            </span>
            <span className="rounded-full border border-rule-2 px-2.5 py-1 text-[12px] text-ink-3">
              {subjectLabel(inferSubject(row))}
            </span>
            <span className="rounded-full border border-rule-2 px-2.5 py-1 text-[12px] text-ink-3">
              {methodLabel(row.match_method)}
            </span>
            <span className="rounded-full border border-rule-2 px-2.5 py-1 text-[12px] text-ink-3">
              信心 {confidence}%
            </span>
          </div>
          <h2 className="mt-3 text-[32px] font-semibold leading-tight md:text-[38px]">{row.external_label}</h2>
          <p className="mt-2 text-[13px] leading-6 text-ink-3">{path}</p>
        </div>
        <div className="shrink-0 text-right serif text-[34px] font-semibold text-[#1f5d78]">
          {total ? index + 1 : 0}/{total}
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[1fr_320px]">
        <div>
          <div className="grid gap-3 md:grid-cols-2">
            <KnowledgeUnitDetail row={row} />
            <InfoBlock label="來源碼" value={row.external_code} />
            <InfoBlock label="來源題數" value={toDisplay(evidence.question_count)} />
            <InfoBlock label="冊別 / 版本" value={[toDisplay(evidence.term), toDisplay(evidence.publisher)].filter(Boolean).join(" / ") || "未提供"} />
          </div>

          <div className="mt-4 rounded-md border border-rule bg-[#fffdf8] p-3">
            <div className="text-[12px] font-semibold text-ink-3">系統對齊理由</div>
            <p className="mt-1 text-[13.5px] leading-7 text-ink-2">
              {toDisplay(evidence.reason) || "未提供理由。"}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-rule bg-[#fbfaf6] p-3">
          <div className="text-[12px] font-semibold text-ink-3">人工審核</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <MiniCount label="通過" value={row.approved_count} tone="good" />
            <MiniCount label="退回" value={row.rejected_count} tone="danger" />
            <MiniCount label="修正" value={row.revised_count} tone="accent" />
          </div>

          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="教師備註：例如名稱不精準、章節太粗、可作為題數覆蓋參考..."
            className="mt-3 min-h-28 w-full resize-y rounded-md border border-rule-2 bg-white p-3 text-[13.5px] leading-6"
          />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              disabled={saving}
              onClick={() => onDecision("approved")}
              className="h-10 rounded-md border border-good bg-good/10 text-[13px] font-semibold text-good disabled:opacity-50"
            >
              通過
            </button>
            <button
              disabled={saving}
              onClick={() => onDecision("revised")}
              className="h-10 rounded-md border border-accent bg-accent-soft text-[13px] font-semibold text-accent disabled:opacity-50"
            >
              修正
            </button>
            <button
              disabled={saving}
              onClick={() => onDecision("rejected")}
              className="h-10 rounded-md border border-danger bg-danger/10 text-[13px] font-semibold text-danger disabled:opacity-50"
            >
              退回
            </button>
          </div>

          <div className="mt-3 flex gap-2 border-t border-rule pt-3">
            <button
              disabled={index <= 0}
              onClick={onPrev}
              className="h-9 flex-1 rounded-md border border-rule-2 bg-white text-[13px] font-semibold disabled:opacity-45"
            >
              上一筆
            </button>
            <button
              disabled={index >= total - 1}
              onClick={onNext}
              className="h-9 flex-1 rounded-md border border-rule-2 bg-white text-[13px] font-semibold disabled:opacity-45"
            >
              下一筆
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function KnowledgeUnitDetail({ row }: { row: Upad12ReviewRow }) {
  const evidence = row.evidence ?? {};
  const kuLabel = toDisplay(evidence.knowledge_unit_label) || row.external_label || row.knowledge_unit_id || "未指定";
  const kuType = toDisplay(evidence.knowledge_unit_type) || "未提供";
  const kuLevel = toDisplay(evidence.knowledge_unit_level) || levelLabel(inferLevel(row));
  const contentTitles = toDisplayList(evidence.ku_content_titles);
  const sourcePath = toDisplayList(evidence.node_path);

  return (
    <div className="rounded-md border border-rule bg-white p-3 md:col-span-2">
      <div className="text-[12px] font-semibold text-ink-3">知識點 / 內部 KnowledgeUnit 狀態</div>
      <div className="mt-2 text-[20px] font-semibold leading-7 text-ink">{kuLabel}</div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <SmallMeta label="KU ID" value={row.knowledge_unit_id ?? "尚未對齊"} />
        <SmallMeta label="類型" value={unitTypeLabel(kuType)} />
        <SmallMeta label="學段" value={kuLevel} />
      </div>
      <div className="mt-3 rounded-md border border-rule bg-[#fffdf8] p-3">
        <div className="text-[12px] font-semibold text-ink-3">源頭內容</div>
        {contentTitles.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] leading-6 text-ink-2">
            {contentTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13.5px] leading-6 text-ink-2">
            目前這筆尚未對齊內部 KnowledgeUnit；請先以知識點名稱、來源路徑、系統理由與題數覆蓋判斷是否保留。
          </p>
        )}
        {sourcePath.length > 0 && (
          <div className="mt-3 border-t border-rule pt-3">
            <div className="text-[12px] font-semibold text-ink-3">來源路徑</div>
            <p className="mt-1 text-[13.5px] leading-6 text-ink-2">{sourcePath.join(" / ")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SmallMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-rule bg-[#fbfaf6] px-3 py-2">
      <div className="text-[11px] font-semibold text-ink-3">{label}</div>
      <div className="mt-1 break-all text-[13px] leading-5 text-ink-2">{value}</div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-rule bg-white p-3">
      <div className="text-[12px] font-semibold text-ink-3">{label}</div>
      <div className="mt-1 break-all text-[13.5px] leading-6 text-ink-2">{value}</div>
    </div>
  );
}

function MiniCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "danger" | "accent";
}) {
  const cls = tone === "good" ? "text-good" : tone === "danger" ? "text-danger" : "text-accent";
  return (
    <div className="rounded-md border border-rule bg-white px-2 py-2">
      <div className={`text-[20px] font-semibold ${cls}`}>{value}</div>
      <div className="text-[11px] text-ink-3">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: Upad12ReviewRow["teacher_review_status"] }) {
  const config = {
    pending: ["待審", "border-warn/30 bg-warn/10 text-warn"],
    approved: ["已通過", "border-good/30 bg-good/10 text-good"],
    rejected: ["已退回", "border-danger/30 bg-danger/10 text-danger"],
    revised: ["需修正", "border-accent/25 bg-accent-soft text-accent"],
  }[status];
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${config[1]}`}>
      {config[0]}
    </span>
  );
}

function inferLevel(row: Upad12ReviewRow): LevelFilter {
  const evidence = row.evidence ?? {};
  const text = [
    row.knowledge_unit_id ?? "",
    ...(row.external_path ?? []),
    toDisplay(evidence.knowledge_unit_level),
    toDisplay(evidence.level),
    toDisplay(evidence.education_level),
    toDisplay(evidence.node_path),
  ].join(" ");

  const gradeMatch = text.match(/\bG(\d{1,2})\b/i);
  if (gradeMatch) {
    const grade = Number(gradeMatch[1]);
    if (grade >= 1 && grade <= 6) return "elementary";
    if (grade >= 7 && grade <= 9) return "junior_high";
    if (grade >= 10 && grade <= 12) return "senior_high";
  }

  if (hasAny(text, ["國小", "elementary"])) return "elementary";
  if (hasAny(text, ["國中", "junior", "junior_high"])) return "junior_high";
  if (hasAny(text, ["高中", "senior", "senior_high"])) return "senior_high";

  return "uncategorized";
}

function inferSubject(row: Upad12ReviewRow): SubjectFilter {
  const evidence = row.evidence ?? {};
  const explicitSubject = normalizeSubjectName(toDisplay(evidence.subject_name) || toDisplay(evidence.subject));
  if (explicitSubject !== "uncategorized") return explicitSubject;

  const text = [
    row.external_label,
    row.knowledge_unit_id ?? "",
    ...(row.external_path ?? []),
    toDisplay(evidence.subject),
    toDisplay(evidence.subject_name),
    toDisplay(evidence.node_path),
    toDisplay(evidence.ku_content_titles),
  ].join(" ");

  if (hasAny(text, ["數學", "數學A", "數學B"])) return "math";
  if (hasAny(text, ["國語", "國文", "中華文化", "閱讀", "寫作", "聆聽"])) return "chinese";
  if (hasAny(text, ["英語", "英文"])) return "english";
  if (hasAny(text, ["社會", "歷史", "地理", "公民"])) return "social";
  if (hasAny(text, ["自然與生活科技", "自然(理化)", "自然(生物)", "自然(地科)", "物理", "化學", "生物", "地球科學", "科學"])) {
    return "science";
  }

  const mathSignals = [
    "數", "式", "量", "幾何", "圖形", "三角", "圓", "線", "角", "面積", "體積",
    "方程", "函數", "比例", "分數", "小數", "百分率", "統計", "機率", "向量", "矩陣",
    "指數", "對數", "多項式", "坐標", "截距", "斜率", "四則運算", "等比", "等差",
  ];
  if (hasAny(text, mathSignals)) return "math";

  const scienceSignals = ["細胞", "植物", "動物", "太陽", "月球", "能量", "溫度", "電路", "酸鹼", "氧化", "岩石"];
  if (hasAny(text, scienceSignals)) return "science";

  return "uncategorized";
}

function normalizeSubjectName(subjectName: string): SubjectFilter {
  if (["數學", "數學A", "數學B"].includes(subjectName)) return "math";
  if (["國語", "國語(首冊)", "國文", "國寫"].includes(subjectName)) return "chinese";
  if (["英語", "英文"].includes(subjectName)) return "english";
  if (["自然與生活科技", "自然(理化)", "自然(生物)", "自然(地科)", "物理", "化學", "生物", "基礎地球科學"].includes(subjectName)) {
    return "science";
  }
  if (["社會", "社會(歷史)", "社會(地理)", "社會(公民)", "歷史", "地理", "公民與社會", "選修歷史", "選修地理"].includes(subjectName)) {
    return "social";
  }
  return "uncategorized";
}

function subjectLabel(subject: SubjectFilter) {
  if (subject === "math") return "數學";
  if (subject === "chinese") return "國文";
  if (subject === "english") return "英文";
  if (subject === "science") return "自然";
  if (subject === "social") return "社會";
  if (subject === "uncategorized") return "未分類";
  return "全部";
}

function levelLabel(level: LevelFilter) {
  if (level === "elementary") return "國小";
  if (level === "junior_high") return "國中";
  if (level === "senior_high") return "高中";
  if (level === "uncategorized") return "未分類";
  return "全部";
}

function hasAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function sourceLabel(source: string) {
  if (source === "quick") return "快速命題";
  if (source === "concept3") return "知識概念";
  return source;
}

function methodLabel(method: string) {
  if (method === "coverage") return "題數覆蓋";
  if (method === "exact") return "名稱相同";
  if (method === "alias") return "別名相符";
  if (method === "embedding") return "語意相近";
  if (method === "manual") return "人工指定";
  return method;
}

function unitTypeLabel(type: string) {
  if (type === "concept") return "概念";
  if (type === "skill") return "技能";
  if (type === "problem_type") return "題型";
  if (type === "representation") return "表徵";
  if (type === "attribute") return "屬性";
  return type;
}

function toDisplayList(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => toDisplay(item)).filter(Boolean);
  }
  const text = toDisplay(value);
  return text ? [text] : [];
}

function toDisplay(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
