"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Book, Page, PageStatus } from "@/lib/types";

const STATUS_BADGE: Record<PageStatus, { label: string; cls: string }> = {
  pending:        { label: "未標", cls: "bg-rule text-ink-3" },
  auto_suggested: { label: "AI 預標", cls: "bg-warn/20 text-warn" },
  human_verified: { label: "已確認", cls: "bg-good/20 text-good" },
  skipped:        { label: "跳過",   cls: "bg-ink-4/20 text-ink-3" },
};

export default function BookPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | PageStatus>("all");

  useEffect(() => {
    const sb = supabase();
    Promise.all([
      sb.from("v_annotation_books").select("*").eq("id", params.id).single(),
      sb.from("annotation_pages")
        .select("*")
        .eq("book_id", params.id)
        .order("page_number", { ascending: true }),
    ]).then(([bookRes, pagesRes]) => {
      setBook(bookRes.data as Book | null);
      setPages((pagesRes.data as Page[]) ?? []);
      setLoading(false);
    });
  }, [params.id]);

  const filtered = pages.filter((p) => filter === "all" || p.status === filter);

  const counts = pages.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<PageStatus, number>);

  const goToFirstPending = () => {
    const next = pages.find((p) => p.status === "pending" || p.status === "auto_suggested");
    if (next) router.push(`/book/${params.id}/page/${next.id}`);
  };

  if (loading) return <div className="p-10 text-ink-3">載入中…</div>;
  if (!book) return <div className="p-10 text-danger">找不到這本書。</div>;

  return (
    <main className="min-h-screen bg-paper">
      <div className="border-b border-rule bg-paper">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center gap-4">
          <Link
            href={book.edition === "實力驗收" ? "/label?mode=practice" : "/label"}
            className="text-[13px] text-ink-3 hover:text-ink"
          >
            ← 全部書本
          </Link>
          <div className="flex-1 serif text-[15px] font-semibold truncate">{book.title}</div>
          <span className="text-[10px] uppercase tracking-wider text-ink-3 border border-rule-2 px-2 py-0.5 rounded">
            {book.source_tier}
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <button
            onClick={goToFirstPending}
            className="px-4 py-2 rounded-md bg-ink text-paper text-[13px] hover:opacity-90"
          >
            從未標頁開始 →
          </button>
          <div className="flex-1" />
          <FilterChip label="全部" n={pages.length} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterChip label="未標" n={counts.pending ?? 0} active={filter === "pending"} onClick={() => setFilter("pending")} />
          <FilterChip label="AI預標" n={counts.auto_suggested ?? 0} active={filter === "auto_suggested"} onClick={() => setFilter("auto_suggested")} />
          <FilterChip label="已確認" n={counts.human_verified ?? 0} active={filter === "human_verified"} onClick={() => setFilter("human_verified")} />
          <FilterChip label="跳過" n={counts.skipped ?? 0} active={filter === "skipped"} onClick={() => setFilter("skipped")} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {filtered.map((p) => (
            <Link
              key={p.id}
              href={`/book/${book.id}/page/${p.id}`}
              className="block aspect-[4/5] border border-rule-2 rounded-md p-2 hover:border-ink-3 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-ink-3">p.{p.page_number}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_BADGE[p.status].cls}`}>
                  {STATUS_BADGE[p.status].label}
                </span>
              </div>
              <div className="text-ink-4 text-[10px]">
                {p.width}×{p.height}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

function FilterChip({
  label, n, active, onClick,
}: { label: string; n: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-2.5 py-1 rounded text-[12px] border transition-colors " +
        (active ? "bg-ink text-paper border-ink" : "bg-paper text-ink-2 border-rule-2 hover:bg-rule/50")
      }
    >
      {label} <span className="text-[10px] opacity-60">{n}</span>
    </button>
  );
}
