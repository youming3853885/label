"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type TabKey = "kg" | "t0" | "upad12";
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
    label: "UPAD12 教師審核",
    eyebrow: "UPAD12",
    description: "審查下載回來的外部資料是否可作為 KG 參考證據。",
  },
] as const;

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
    () => tabs.find((tab) => tab.key === activeTab) ?? tabs[0],
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

  useEffect(() => {
    setReviewerName(localStorage.getItem(REVIEWER_STORAGE_KEY) ?? "");
  }, []);

  useEffect(() => {
    if (reviewerName.trim()) {
      localStorage.setItem(REVIEWER_STORAGE_KEY, reviewerName.trim());
    }
  }, [reviewerName]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase()
      .from("v_upad12_teacher_review_queue")
      .select("*")
      .order("confidence", { ascending: false })
      .limit(3000);

    if (source !== "all") query = query.eq("source_area", source);
    if (status !== "all") query = query.eq("teacher_review_status", status);

    const { data, error: loadError } = await query;
    if (loadError) {
      setError(loadError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Upad12ReviewRow[]);
    }
    setLoading(false);
  }, [source, status]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const channel = supabase()
      .channel("upad12-review-decisions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upad12_teacher_review_decisions" },
        () => void loadRows(),
      )
      .subscribe();
    return () => {
      void supabase().removeChannel(channel);
    };
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (level !== "all" && inferLevel(row) !== level) {
        return false;
      }
      if (subject !== "all" && inferSubject(row) !== subject) {
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
  }, [rows, level, search, subject]);

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
    return rows.reduce(
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
  }, [level, rows, subject]);

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
      await loadRows();
    }
    setSavingId(null);
  };

  return (
    <div className="min-h-[calc(100vh-65px)] bg-[#f4f0e7] bg-[linear-gradient(#e8e0d3_1px,transparent_1px),linear-gradient(90deg,#e8e0d3_1px,transparent_1px)] bg-[size:20px_20px] px-5 py-5">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-md border border-rule bg-paper/95 p-3 shadow-[0_12px_34px_rgba(28,37,34,.06)]">
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="抽樣項目" value={summary.total} />
            <StatCard label="已審查" value={summary.approved + summary.rejected + summary.revised} tone="good" />
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
                <option value="pending">待審</option>
                <option value="approved">通過</option>
                <option value="rejected">退回</option>
                <option value="revised">需修正</option>
                <option value="all">全部</option>
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
              onClick={() => void loadRows()}
              className="h-10 w-full rounded-md border border-ink bg-ink px-4 text-[14px] font-semibold text-paper"
            >
              同步整理
            </button>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 rounded-md border border-rule bg-[#fffdf8] px-4 py-3 text-[12.5px] leading-6 text-ink-3">
            UPAD12 資料只作為外部參考證據。多人協作時，每位老師按下通過、修正或退回後都會寫入 Supabase，其他人的畫面會透過 Realtime 重新整理。
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
              {error}
            </div>
          )}

          {loading && <div className="rounded-md border border-rule bg-paper p-5 text-ink-3">載入 UPAD12 審核清單...</div>}
          {!loading && !currentRow && (
            <div className="rounded-md border border-rule bg-paper p-5 text-ink-3">目前沒有符合條件的資料。</div>
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
            <InfoBlock label="UPAD12 來源碼" value={row.external_code} />
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
  const kuLabel = toDisplay(evidence.knowledge_unit_label) || row.knowledge_unit_id || "未指定";
  const kuType = toDisplay(evidence.knowledge_unit_type) || "未提供";
  const kuLevel = toDisplay(evidence.knowledge_unit_level) || levelLabel(inferLevel(row));
  const contentTitles = toDisplayList(evidence.ku_content_titles);

  return (
    <div className="rounded-md border border-rule bg-white p-3 md:col-span-2">
      <div className="text-[12px] font-semibold text-ink-3">對齊 KnowledgeUnit</div>
      <div className="mt-2 text-[20px] font-semibold leading-7 text-ink">{kuLabel}</div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <SmallMeta label="KU ID" value={row.knowledge_unit_id ?? "未指定"} />
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
            目前這筆只有 KU 名稱與 ID，正式 KnowledgeUnit 內容表尚未匯入；請先以 KU 名稱、UPAD12 路徑、系統對齊理由與題數覆蓋判斷。
          </p>
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
