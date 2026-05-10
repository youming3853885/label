"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type TabKey = "kg" | "t0";

const T0_REVIEW_URL =
  process.env.NEXT_PUBLIC_T0_REVIEW_URL ?? "/t0_review.html?bust=20260510clean";

const SHARED_EMAIL = "annotator@label.local";

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
    description: "抽樣審查、同步檢視、匯出 CSV / JSON。",
  },
] as const;

const flow = [
  {
    title: "官方課綱",
    text: "先確定每個年級該學什麼。",
    color: "bg-[#d6f3f1] border-[#8ecfca]",
  },
  {
    title: "教材與題庫",
    text: "接上實際講義、題目與學生作答。",
    color: "bg-[#ffe6b8] border-[#e7bd6a]",
  },
  {
    title: "問途知識地圖",
    text: "整理成孩子看得懂的學習路線。",
    color: "bg-paper border-ink shadow-[0_0_0_2px_rgba(26,26,26,0.08)]",
  },
  {
    title: "老師把關",
    text: "重要判斷由老師確認。",
    color: "bg-[#d9f5df] border-[#95d6a2]",
  },
  {
    title: "教學應用",
    text: "回到答疑、補救、週報與試學招生。",
    color: "bg-[#ffe0dc] border-[#e9a39a]",
  },
];

const outcomes = [
  ["學生", "知道自己卡在哪裡，下一步不再亂猜。"],
  ["老師", "快速看出全班共同弱點。"],
  ["家長", "週報能說清楚孩子進步與待補強處。"],
  ["補習班", "試學診斷變成可理解、可跟進的招生報告。"],
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
              課綱審核與講義標註入口
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
                Label
              </div>
              <div className="mt-1 text-[15px] font-semibold">講義標註</div>
              <p className="mt-1 text-[12px] leading-5 opacity-70">
                點擊後開啟新頁面：label · 講義標註。
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
            <div className="text-[13px] text-ink-3">{active.description}</div>
          </header>

          {activeTab === "kg" ? <KnowledgeGraphTab /> : <T0ReviewTab />}
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
      setMsg("密碼不正確，請重新輸入。");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="serif mb-1 text-[28px] font-semibold">label · 課綱審核入口</div>
        <p className="mb-6 text-[13.5px] leading-7 text-ink-3">
          輸入共用審核密碼後即可使用知識圖譜說明、T0 共編審查與講義標註。
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
            一張圖講清楚
          </span>
          <h2 className="serif mt-5 text-[42px] font-semibold leading-tight md:text-[56px]">
            知識圖譜就是孩子的學習導航圖
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-[16px] leading-8 text-ink-2">
            把「課綱、教材、題庫、學生作答」整理成一張可追蹤的學習地圖，讓老師、家長與補習班知道：孩子已經會什麼、卡在哪裡、下一步該做什麼。
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
            "不是技術資料庫，而是 K-12 學習導航圖。",
            "內容先對齊官方課綱，再接教材與題庫。",
            "AI 只做整理與建議，老師保留最後確認權。",
            "最後服務教學、補救、週報與招生。",
          ].map((point) => (
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
              同源視窗同步
            </span>
            <span className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">
              匯出 JSON
            </span>
            <span className="rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[12px] font-semibold text-warn">
              匯出 CSV
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">
            內嵌 T0 課綱抽樣審查工作台。跨裝置多人共編若要正式使用，下一步需接 Supabase 共享審核表。
          </p>
        </div>
        <a
          href={T0_REVIEW_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-[13px] font-semibold text-paper"
        >
          新頁開啟工作台
        </a>
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
