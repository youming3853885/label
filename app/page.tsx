"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Book } from "@/lib/types";

export default function HomePage() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>("國中");

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
    if (!user) return;
    const sb = supabase();
    sb.from("v_annotation_books")
      .select("*")
      .eq("level", filterLevel)
      .order("subject", { ascending: true })
      .order("grade", { ascending: true })
      .then(({ data }) => setBooks((data as Book[]) ?? []));
  }, [user, filterLevel]);

  if (loading) {
    return <Centered>載入中…</Centered>;
  }

  if (!user) {
    return <LoginCard />;
  }

  return (
    <main className="min-h-screen bg-paper">
      <Topbar email={user.email} />
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="serif text-[32px] font-semibold mb-2">講義標註</h1>
        <p className="text-ink-3 text-[13.5px] mb-6">
          挑一本書開始標。每頁標完按「確認」會自動進入下一頁。
        </p>

        <div className="flex gap-2 mb-5">
          {(["國小", "國中", "高中"] as const).map((lv) => (
            <button
              key={lv}
              onClick={() => setFilterLevel(lv)}
              className={
                "px-3 py-1.5 rounded-md text-[13px] border transition-colors " +
                (filterLevel === lv
                  ? "bg-ink text-paper border-ink"
                  : "bg-paper text-ink border-rule-2 hover:bg-rule")
              }
            >
              {lv}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {books.length === 0 && (
            <div className="text-ink-3 text-[13px] py-8 text-center col-span-full">
              這個學齡段還沒有書。先跑 upload 腳本上傳 PNG。
            </div>
          )}
          {books.map((b) => {
            // Skipped pages (TOC / 版權頁 / blank) count as processed —
            // they're done in the sense that the annotator has decided
            // there's nothing useful to label on them.
            const verified = b.pages_verified ?? 0;
            const skipped = b.pages_skipped ?? 0;
            const done = verified + skipped;
            const total = b.total_pages || 1;
            const pct = Math.round((done / total) * 100);
            return (
              <Link
                key={b.id}
                href={`/book/${b.id}`}
                className="block p-4 rounded-md border border-rule-2 bg-paper hover:border-ink-3 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="serif text-[16px] font-semibold">{b.title}</div>
                  <span className="text-[10px] uppercase tracking-wider text-ink-3">{b.source_tier}</span>
                </div>
                <div className="text-[12px] text-ink-3">
                  {b.level} · {b.subject} · {b.grade}年級 · {b.total_pages} 頁
                </div>
                <div className="mt-3 h-1.5 bg-rule rounded-full overflow-hidden">
                  <div
                    className="h-full bg-good"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-ink-3">
                  {done} / {b.total_pages} 已處理 ({pct}%)
                  {skipped > 0 && (
                    <span className="ml-1 text-ink-4">
                      — 確認 {verified}、略過 {skipped}
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
    <div className="min-h-screen bg-paper flex items-center justify-center text-ink-3">
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
      <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
        <div className="serif text-[16px] font-semibold">label · 講義標註</div>
        <div className="flex items-center gap-3 text-[12px] text-ink-3">
          <span>{email}</span>
          <button onClick={handleLogout} className="hover:text-ink">登出</button>
        </div>
      </div>
    </div>
  );
}

// Shared annotator account — every teacher uses the same auth credentials.
// Per-teacher attribution is via the typed `annotator_name` they enter
// after login (NameModal, stored in localStorage and attached to each box).
const SHARED_EMAIL = "annotator@label.local";

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
      setMsg("密碼不對，請再試一次。");
    } else {
      // session refreshes automatically via onAuthStateChange in the page.
    }
  };

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="serif text-[28px] font-semibold mb-1">label · 標籤工具</div>
        <p className="text-[13.5px] text-ink-3 mb-6">
          輸入訪問密碼即可開始標註。<br />
          下一步會請你輸入個人姓名作為標註負責人記錄。
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && password.trim() && submit()}
          placeholder="訪問密碼"
          autoFocus
          className="w-full h-11 px-3 rounded-md border border-rule-2 text-[14px] tracking-widest"
        />
        <button
          onClick={submit}
          disabled={busy || !password.trim()}
          className="mt-3 w-full h-11 rounded-md bg-ink text-paper text-[14px] disabled:opacity-50"
        >
          {busy ? "登入中…" : "進入"}
        </button>
        {msg && <p className="mt-3 text-[12.5px] text-danger">{msg}</p>}
      </div>
    </main>
  );
}
