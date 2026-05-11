"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Book } from "@/lib/types";

const LEVELS = [
  { value: "國小", label: "國小" },
  { value: "國中", label: "國中" },
  { value: "高中", label: "高中" },
] as const;

const SHARED_EMAIL = "annotator@label.local";

export default function LabelHomePage() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>("國中");
  const [mode, setMode] = useState<"all" | "practice">("all");

  const isPracticeMode = mode === "practice";

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "practice") {
      setMode("practice");
      setFilterLevel("國中");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const sb = supabase();
    let query = sb.from("v_annotation_books")
      .select("*")
      .eq("level", filterLevel);

    if (isPracticeMode) {
      query = query.eq("edition", "實力驗收");
    }

    query
      .order("subject", { ascending: true })
      .order("grade", { ascending: true })
      .then(({ data }) => setBooks((data as Book[]) ?? []));
  }, [user, filterLevel, isPracticeMode]);

  if (loading) {
    return <Centered>載入中...</Centered>;
  }

  if (!user) {
    return <LoginCard />;
  }

  return (
    <main className="min-h-screen bg-paper">
      <Topbar email={user.email} />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-accent">
              label
            </p>
            <h1 className="serif mt-1 text-[34px] font-semibold">
              {isPracticeMode ? "實力驗收校稿" : "講義標註"}
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-7 text-ink-3">
              {isPracticeMode
                ? "國中全科實力驗收 PDF 已獨立分頁，人員可逐頁校稿、標註題目與答案，結果同步寫回 Supabase。"
                : "選擇講義後逐頁標註題目、選項、答案、詳解與圖形區塊。所有標註會寫回 Supabase，供後續題庫整理與 AI 檢索使用。"}
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md border border-rule-2 px-4 text-[13px] font-semibold text-ink-2 hover:bg-rule"
          >
            回到審核入口
          </Link>
        </div>

        <div className="mb-5 flex gap-2">
          {LEVELS.map((lv) => (
            <button
              key={lv.value}
              onClick={() => setFilterLevel(lv.value)}
              className={
                "rounded-md border px-3 py-1.5 text-[13px] transition-colors " +
                (filterLevel === lv.value
                  ? "border-ink bg-ink text-paper"
                  : "border-rule-2 bg-paper text-ink hover:bg-rule")
              }
            >
              {lv.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {books.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed border-rule-2 py-10 text-center text-[13px] text-ink-3">
              目前沒有符合此學段的講義。
            </div>
          )}
          {books.map((book) => {
            const verified = book.pages_verified ?? 0;
            const skipped = book.pages_skipped ?? 0;
            const done = verified + skipped;
            const total = book.total_pages || 1;
            const pct = Math.round((done / total) * 100);
            return (
              <Link
                key={book.id}
                href={`/book/${book.id}`}
                className="block rounded-md border border-rule-2 bg-paper p-4 transition-colors hover:border-ink-3"
              >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <div className="serif text-[16px] font-semibold">{book.title}</div>
                  <span className="text-[10px] uppercase tracking-wider text-ink-3">
                    {book.source_tier}
                  </span>
                </div>
                <div className="text-[12px] text-ink-3">
                  {book.level} · {book.subject} · {book.grade} 年級 · {book.total_pages} 頁
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-rule">
                  <div className="h-full bg-good" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-ink-3">
                  {done} / {book.total_pages} 完成 ({pct}%)
                  {skipped > 0 && (
                    <span className="ml-1 text-ink-4">
                      已核 {verified}，跳過 {skipped}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
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

function Topbar({ email }: { email?: string }) {
  const handleLogout = async () => {
    await supabase().auth.signOut();
    window.location.reload();
  };
  return (
    <div className="border-b border-rule bg-paper">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">
        <div className="serif text-[16px] font-semibold">label · 講義標註</div>
        <div className="flex items-center gap-3 text-[12px] text-ink-3">
          <span>{email}</span>
          <button onClick={handleLogout} className="hover:text-ink">
            登出
          </button>
        </div>
      </div>
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
        <div className="serif mb-1 text-[28px] font-semibold">label · 講義標註</div>
        <p className="mb-6 text-[13.5px] leading-7 text-ink-3">
          輸入共用審核密碼後即可進入講義標註工作台。
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
