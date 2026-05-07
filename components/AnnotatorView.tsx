"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Stage, Layer, Image as KImage, Rect, Text, Group } from "react-konva";
import { supabase } from "@/lib/supabase";

const BUCKET = "annotation-source";
import {
  Box, BoxType, Difficulty, Page, Book,
  BOX_TYPE_INFO, DIFFICULTY_KEYS, DIFFICULTY_LABEL,
} from "@/lib/types";
import { NameModal } from "./NameModal";

/**
 * The annotator canvas. Single page at a time. Draw rectangles by
 * click-and-drag, click an existing box to select & edit, hotkeys to set
 * type / difficulty, "Q1, Q2..." auto-numbering for cross-page pairing,
 * dual-pass toggle (question / answer) for back-of-book answer keys.
 */
export function AnnotatorView() {
  const params = useParams<{ id: string; pageId: string }>();
  const router = useRouter();

  const [annotatorName, setReady] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [allPages, setAllPages] = useState<Page[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  // Drawing state
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [activeType, setActiveType] = useState<BoxType>("question");
  const [pendingNumber, setPendingNumber] = useState<number | null>(null);
  const [selected, setSelected] = useState<Box | null>(null);
  // "question" pass = labeling question stems (auto-incrementing Q-number).
  // "answer" pass = labeling answer/solution boxes (Q-number must match).
  const [pass, setPass] = useState<"question" | "answer">("question");
  const [busy, setBusy] = useState(false);
  const stageWrapRef = useRef<HTMLDivElement>(null);

  // Cross-page pairing for answer pass.
  // bookQuestions = every type=question box in this book (for the dropdown).
  // pairingQNum = which Q the next-drawn answer/solution box gets paired with.
  // autoAdvance = after saving, jump to the next unpaired Q automatically.
  type BookQ = {
    id: string;
    question_number: number;
    page_id: string;
    bbox: { x: number; y: number; w: number; h: number };
    page_number?: number;
    page_png_path?: string;
    page_width?: number;
    page_height?: number;
  };
  const [bookQuestions, setBookQuestions] = useState<BookQ[]>([]);
  const [pairingQNum, setPairingQNum] = useState<number | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [pairingFilter, setPairingFilter] = useState("");

  // In question pass, every box drawn after a question stem inherits that
  // stem's Q-number. So labeling Q2 then drawing an option/answer/solution
  // automatically pairs them with Q2 — matching how teachers naturally
  // work: stem → its options → its answer → its solution → next stem.
  const [currentQInPass, setCurrentQInPass] = useState<number | null>(null);

  // Load book + all pages + this page + boxes
  useEffect(() => {
    if (!annotatorName) return;
    const sb = supabase();
    Promise.all([
      sb.from("v_annotation_books").select("*").eq("id", params.id).single(),
      sb.from("annotation_pages").select("*").eq("book_id", params.id).order("page_number"),
      sb.from("annotation_pages").select("*").eq("id", params.pageId).single(),
      sb.from("annotation_boxes").select("*").eq("page_id", params.pageId),
    ]).then(([bookRes, allRes, pageRes, boxRes]) => {
      setBook(bookRes.data as Book | null);
      setAllPages((allRes.data as Page[]) ?? []);
      setPage(pageRes.data as Page | null);
      setBoxes((boxRes.data as Box[]) ?? []);
    });
  }, [annotatorName, params.id, params.pageId]);

  // Load image for the page using the Supabase JS storage client.
  // Avoids hand-crafting an /authenticated/... URL (which can 400 depending
  // on the bucket's auth policy) — download() reliably attaches the session.
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    setImg(null);
    setImgErr(null);
    (async () => {
      try {
        const { data, error } = await supabase()
          .storage.from(BUCKET).download(page.png_path);
        if (error || !data) {
          throw error ?? new Error("empty blob");
        }
        if (cancelled) return;
        const objUrl = URL.createObjectURL(data);
        const im = new window.Image();
        im.onload = () => {
          if (!cancelled) setImg(im);
        };
        im.onerror = () => {
          if (!cancelled) setImgErr("圖片解析失敗");
        };
        im.src = objUrl;
      } catch (e: any) {
        console.error("page image download failed", e);
        if (!cancelled) {
          setImgErr(`下載失敗：${e?.message ?? String(e)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  // Compute display scale so the page image fits ~70% of viewport width
  useEffect(() => {
    const update = () => {
      if (!page || !stageWrapRef.current) return;
      const w = stageWrapRef.current.clientWidth;
      setScale(Math.min(1, w / page.width));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [page]);

  // Auto-pick next question number based on existing boxes book-wide.
  // Use bookQuestions (cross-page) so numbering doesn't reset per page.
  const nextQuestionNumber = useMemo(() => {
    const max = bookQuestions.reduce(
      (m, b) => Math.max(m, b.question_number ?? 0),
      0,
    );
    return max + 1;
  }, [bookQuestions]);

  // Fetch every question box for the book — used by the answer-pass dropdown.
  // Includes the source page's page_number for the "Q3 (第 X 頁)" hint.
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase()
        .from("annotation_boxes")
        .select("id, question_number, page_id, bbox, page:annotation_pages(page_number, png_path, width, height)")
        .eq("book_id", book.id)
        .eq("type", "question")
        .not("question_number", "is", null)
        .order("question_number");
      if (cancelled) return;
      const flat: BookQ[] = ((data as any[]) ?? [])
        .map((r) => ({
          id: r.id,
          question_number: r.question_number,
          page_id: r.page_id,
          bbox: r.bbox,
          page_number: r.page?.page_number,
          page_png_path: r.page?.png_path,
          page_width: r.page?.width,
          page_height: r.page?.height,
        }));
      // Dedup by question_number — same number can appear on multiple pages
      // if user accidentally created duplicates; keep the first.
      const seen = new Set<number>();
      const unique = flat.filter((q) => {
        if (seen.has(q.question_number)) return false;
        seen.add(q.question_number);
        return true;
      });
      setBookQuestions(unique);
    })();
    return () => {
      cancelled = true;
    };
  }, [book, boxes]);

  // When user switches to answer pass, default pairing to the smallest Q.
  useEffect(() => {
    if (pass === "answer" && pairingQNum == null && bookQuestions.length > 0) {
      setPairingQNum(bookQuestions[0].question_number);
    }
  }, [pass, bookQuestions, pairingQNum]);

  const pairingQ = useMemo(
    () => bookQuestions.find((q) => q.question_number === pairingQNum) ?? null,
    [bookQuestions, pairingQNum],
  );

  const advancePairingQ = useCallback((delta: 1 | -1) => {
    if (pairingQNum == null || bookQuestions.length === 0) return;
    const idx = bookQuestions.findIndex((q) => q.question_number === pairingQNum);
    const next = bookQuestions[Math.max(0, Math.min(bookQuestions.length - 1, idx + delta))];
    if (next) setPairingQNum(next.question_number);
  }, [pairingQNum, bookQuestions]);

  // Save a new box. Uses the current activeType + pairing-question logic.
  const saveBox = useCallback(
    async (bbox: { x: number; y: number; w: number; h: number }) => {
      if (!page || !book || !annotatorName) return;
      const sb = supabase();
      const { data: userData } = await sb.auth.getUser();
      const created_by = userData.user?.id ?? null;

      // Question-number resolution rules:
      //   answer pass         → use pairingQNum (the dropdown choice)
      //   question pass:
      //     type=question     → auto-increment book-wide; mark this as "currentQ"
      //     other types       → inherit from currentQInPass (most-recent stem
      //                         labeled in this session; spans pages)
      let qnum: number | null = null;
      let nextCurrentQ = currentQInPass;
      if (pass === "answer") {
        qnum = pairingQNum;
      } else if (activeType === "question") {
        qnum = pendingNumber ?? nextQuestionNumber;
        nextCurrentQ = qnum;
      } else {
        qnum = currentQInPass;
      }

      const { data, error } = await sb
        .from("annotation_boxes")
        .insert({
          page_id: page.id,
          book_id: book.id,
          type: activeType,
          bbox,
          question_number: qnum,
          annotator_name: annotatorName,
          created_by,
          source: "human",
        })
        .select()
        .single();
      if (error) {
        alert(`儲存失敗：${error.message}`);
        return;
      }
      setBoxes((bs) => [...bs, data as Box]);
      setSelected(data as Box);
      setPendingNumber(null);
      // Update sticky Q-number for question pass.
      if (nextCurrentQ !== currentQInPass) setCurrentQInPass(nextCurrentQ);

      // Auto-advance to next Q in answer pass when toggle is on.
      if (pass === "answer" && autoAdvance) {
        advancePairingQ(1);
      }
    },
    [page, book, annotatorName, activeType, pendingNumber, nextQuestionNumber, pass, pairingQNum, autoAdvance, advancePairingQ, currentQInPass],
  );

  // Patch (update) an existing box — used for difficulty / qnum / option_letter
  const patchBox = useCallback(async (id: string, patch: Partial<Box>) => {
    const sb = supabase();
    const { data, error } = await sb
      .from("annotation_boxes")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      alert(`更新失敗：${error.message}`);
      return;
    }
    setBoxes((bs) => bs.map((b) => (b.id === id ? (data as Box) : b)));
    if (selected?.id === id) setSelected(data as Box);
  }, [selected]);

  const deleteBox = useCallback(async (id: string) => {
    const sb = supabase();
    const { error } = await sb.from("annotation_boxes").delete().eq("id", id);
    if (error) {
      alert(`刪除失敗：${error.message}`);
      return;
    }
    setBoxes((bs) => bs.filter((b) => b.id !== id));
    if (selected?.id === id) setSelected(null);
  }, [selected]);

  // Mark page verified + jump to next page
  const verifyPage = useCallback(async () => {
    if (!page) return;
    setBusy(true);
    const sb = supabase();
    const { data: userData } = await sb.auth.getUser();
    await sb
      .from("annotation_pages")
      .update({
        status: "human_verified",
        verified_by: userData.user?.id,
        verified_by_name: annotatorName,
        verified_at: new Date().toISOString(),
      })
      .eq("id", page.id);
    // Find next non-verified page
    const idx = allPages.findIndex((p) => p.id === page.id);
    const next = allPages.slice(idx + 1).find(
      (p) => p.status !== "human_verified" && p.status !== "skipped",
    );
    setBusy(false);
    if (next) router.push(`/book/${book!.id}/page/${next.id}`);
    else router.push(`/book/${book!.id}`);
  }, [page, allPages, book, annotatorName, router]);

  // Mark page skipped (e.g., TOC, copyright, blank)
  const skipPage = useCallback(async () => {
    if (!page) return;
    setBusy(true);
    const sb = supabase();
    const { data: userData } = await sb.auth.getUser();
    await sb
      .from("annotation_pages")
      .update({
        status: "skipped",
        verified_by: userData.user?.id,
        verified_by_name: annotatorName,
        verified_at: new Date().toISOString(),
      })
      .eq("id", page.id);
    const idx = allPages.findIndex((p) => p.id === page.id);
    const next = allPages.slice(idx + 1).find(
      (p) => p.status !== "human_verified" && p.status !== "skipped",
    );
    setBusy(false);
    if (next) router.push(`/book/${book!.id}/page/${next.id}`);
    else router.push(`/book/${book!.id}`);
  }, [page, allPages, book, annotatorName, router]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!annotatorName) return;
    const onKey = (e: KeyboardEvent) => {
      // Letter shortcuts to set type
      const map: Record<string, BoxType> = {
        q: "question", o: "option", a: "answer",
        s: "solution", f: "figure", x: "skip", u: "unit_title",
      };
      if (e.key.toLowerCase() in map) {
        setActiveType(map[e.key.toLowerCase()]);
        return;
      }
      // 1/2/3 sets difficulty on selected question box
      if (selected?.type === "question" && DIFFICULTY_KEYS[e.key]) {
        e.preventDefault();
        patchBox(selected.id, { difficulty: DIFFICULTY_KEYS[e.key] });
        return;
      }
      // Delete / Backspace to remove selected box
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        deleteBox(selected.id);
        return;
      }
      // Escape to deselect
      if (e.key === "Escape") {
        setSelected(null);
        return;
      }
      // Enter = verify page
      if (e.key === "Enter") {
        e.preventDefault();
        verifyPage();
        return;
      }
      // Tab = toggle pass mode
      if (e.key === "Tab") {
        e.preventDefault();
        setPass((p) => (p === "question" ? "answer" : "question"));
        return;
      }
      // Alt+Left / Alt+Right = prev / next page (no status change)
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const idx = allPages.findIndex((p) => p.id === page?.id);
        const target = e.key === "ArrowLeft"
          ? (idx > 0 ? allPages[idx - 1] : null)
          : (idx >= 0 && idx < allPages.length - 1 ? allPages[idx + 1] : null);
        if (target && book) {
          router.push(`/book/${book.id}/page/${target.id}`);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, patchBox, deleteBox, verifyPage, annotatorName, allPages, page, book, router]);

  if (!annotatorName) return <NameModal onReady={setReady} />;
  if (!book || !page) return <div className="p-10 text-ink-3">載入中…</div>;

  // Stage handlers
  const stagePos = (e: any) => {
    const stage = e.target.getStage();
    const ptr = stage.getPointerPosition();
    return { x: ptr.x / scale, y: ptr.y / scale };
  };

  const onMouseDown = (e: any) => {
    if (e.target !== e.target.getStage()) return; // clicked an existing rect
    const { x, y } = stagePos(e);
    setDrawing({ x, y, w: 0, h: 0 });
    setSelected(null);
  };
  const onMouseMove = (e: any) => {
    if (!drawing) return;
    const { x, y } = stagePos(e);
    setDrawing({ x: drawing.x, y: drawing.y, w: x - drawing.x, h: y - drawing.y });
  };
  const onMouseUp = () => {
    if (!drawing) return;
    const norm = {
      x: Math.round(Math.min(drawing.x, drawing.x + drawing.w)),
      y: Math.round(Math.min(drawing.y, drawing.y + drawing.h)),
      w: Math.round(Math.abs(drawing.w)),
      h: Math.round(Math.abs(drawing.h)),
    };
    setDrawing(null);
    if (norm.w > 8 && norm.h > 8) saveBox(norm);
  };

  return (
    <main className="min-h-screen bg-paper">
      <div className="border-b border-rule bg-paper">
        <div className="max-w-[1600px] mx-auto px-6 h-12 flex items-center gap-4">
          <Link href={`/book/${book.id}`} className="text-[13px] text-ink-3 hover:text-ink">← 回書本</Link>
          <div className="flex-1 serif text-[14px] truncate">{book.title}</div>

          {/* Page navigation — does not change page status, just moves */}
          {(() => {
            const idx = allPages.findIndex((p) => p.id === page.id);
            const prev = idx > 0 ? allPages[idx - 1] : null;
            const next = idx >= 0 && idx < allPages.length - 1 ? allPages[idx + 1] : null;
            return (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => prev && router.push(`/book/${book.id}/page/${prev.id}`)}
                  disabled={!prev}
                  title="上一頁（不改狀態）"
                  className="px-2 h-7 rounded border border-rule-2 text-[12px] hover:bg-rule/40 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← 上一頁
                </button>
                <span className="text-[12px] text-ink-3 tabular-nums px-1">
                  p.{page.page_number} / {book.total_pages}
                </span>
                <button
                  onClick={() => next && router.push(`/book/${book.id}/page/${next.id}`)}
                  disabled={!next}
                  title="下一頁（不改狀態）"
                  className="px-2 h-7 rounded border border-rule-2 text-[12px] hover:bg-rule/40 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一頁 →
                </button>
              </div>
            );
          })()}

          <span className="text-[11px] text-ink-3">標註人：{annotatorName}</span>
          <button
            onClick={() => { localStorage.removeItem("label.annotator_name"); window.location.reload(); }}
            className="text-[11px] text-ink-3 hover:text-ink underline"
          >
            換人
          </button>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-4 grid grid-cols-12 gap-4">
        {/* Canvas */}
        <div className="col-span-9" ref={stageWrapRef}>
          {img && (
            <div
              className="border border-rule-2 inline-block bg-white"
              style={{ width: page.width * scale, height: page.height * scale }}
            >
              <Stage
                width={page.width * scale}
                height={page.height * scale}
                scaleX={scale}
                scaleY={scale}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onTouchStart={onMouseDown}
                onTouchMove={onMouseMove}
                onTouchEnd={onMouseUp}
              >
                <Layer>
                  {/* listening=false makes the image transparent to mouse
                      events — clicks pass through to the Stage handlers
                      so dragging-to-draw works on top of the page image. */}
                  <KImage
                    image={img}
                    width={page.width}
                    height={page.height}
                    listening={false}
                  />
                  {boxes.map((b) => {
                    const color = BOX_TYPE_INFO[b.type].color;
                    const isSelected = selected?.id === b.id;
                    return (
                      <Group
                        key={b.id}
                        onClick={(e) => { e.cancelBubble = true; setSelected(b); }}
                        onTap={(e) => { e.cancelBubble = true; setSelected(b); }}
                      >
                        <Rect
                          x={b.bbox.x}
                          y={b.bbox.y}
                          width={b.bbox.w}
                          height={b.bbox.h}
                          stroke={color}
                          strokeWidth={isSelected ? 4 : 2}
                          fill={`${color}1A`}
                        />
                        <Text
                          x={b.bbox.x + 4}
                          y={b.bbox.y + 4}
                          text={
                            (BOX_TYPE_INFO[b.type].label) +
                            (b.question_number != null ? ` Q${b.question_number}` : "") +
                            (b.option_letter ? ` (${b.option_letter})` : "") +
                            (b.difficulty ? ` ${DIFFICULTY_LABEL[b.difficulty]}` : "")
                          }
                          fontSize={14}
                          fontStyle="bold"
                          fill={color}
                        />
                      </Group>
                    );
                  })}
                  {drawing && (
                    <Rect
                      x={Math.min(drawing.x, drawing.x + drawing.w)}
                      y={Math.min(drawing.y, drawing.y + drawing.h)}
                      width={Math.abs(drawing.w)}
                      height={Math.abs(drawing.h)}
                      stroke={BOX_TYPE_INFO[activeType].color}
                      strokeWidth={2}
                      dash={[6, 4]}
                      fill={`${BOX_TYPE_INFO[activeType].color}1A`}
                    />
                  )}
                </Layer>
              </Stage>
            </div>
          )}
          {!img && !imgErr && (
            <div className="text-ink-3 p-10">載入頁面圖片…</div>
          )}
          {imgErr && (
            <div className="p-10 text-danger text-[13px] space-y-2">
              <div className="font-medium">頁面圖片載入失敗</div>
              <div className="text-ink-3 text-[12px]">{imgErr}</div>
              <div className="text-ink-3 text-[11px] font-mono break-all">
                path: {page.png_path}
              </div>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-3 py-1.5 rounded border border-rule-2 text-[12px]"
              >
                重新整理
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="col-span-3 flex flex-col gap-3 text-[13px]">
          <SectionTitle>類型 (Q O A S F X U)</SectionTitle>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(BOX_TYPE_INFO) as BoxType[]).map((t) => (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                className={
                  "px-2 py-1.5 rounded border text-[12px] transition-colors " +
                  (activeType === t
                    ? "bg-ink text-paper border-ink"
                    : "bg-paper text-ink-2 border-rule-2 hover:bg-rule/40")
                }
                style={activeType === t ? { backgroundColor: BOX_TYPE_INFO[t].color, borderColor: BOX_TYPE_INFO[t].color, color: "#fff" } : undefined}
              >
                {BOX_TYPE_INFO[t].label}
                <span className="ml-1 text-[10px] opacity-60">{BOX_TYPE_INFO[t].key}</span>
              </button>
            ))}
          </div>

          <SectionTitle>模式 (Tab 切換)</SectionTitle>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPass("question")}
              className={"flex-1 px-2 py-1.5 rounded text-[12px] " +
                (pass === "question" ? "bg-good text-white" : "bg-rule text-ink-3")}
            >
              題目 Pass
            </button>
            <button
              onClick={() => setPass("answer")}
              className={"flex-1 px-2 py-1.5 rounded text-[12px] " +
                (pass === "answer" ? "bg-accent text-white" : "bg-rule text-ink-3")}
            >
              答案 Pass
            </button>
          </div>
          {pass === "answer" && (
            <div className="space-y-2 border border-rule-2 rounded p-2">
              {bookQuestions.length === 0 ? (
                <div className="text-[11px] text-ink-3">
                  這本書還沒有任何已標題目。先在「題目 Pass」標好題目，再來這。
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-ink-3">對應題目</span>
                    <span className="text-[10px] text-ink-3">{bookQuestions.length} 題可選</span>
                  </div>

                  {pairingQ && (
                    <div className="text-center py-1">
                      <div className="serif text-[18px] font-semibold text-ink">Q{pairingQ.question_number}</div>
                      <div className="text-[10px] text-ink-3">第 {pairingQ.page_number} 頁</div>
                    </div>
                  )}

                  {pairingQ && (
                    <QuestionPreview q={pairingQ} />
                  )}

                  <div className="flex gap-1">
                    <button
                      onClick={() => advancePairingQ(-1)}
                      className="flex-1 px-2 py-1 rounded border border-rule-2 text-[12px] hover:bg-rule/40"
                    >
                      ← 上一題
                    </button>
                    <button
                      onClick={() => advancePairingQ(1)}
                      className="flex-1 px-2 py-1 rounded border border-rule-2 text-[12px] hover:bg-rule/40"
                    >
                      下一題 →
                    </button>
                  </div>

                  {bookQuestions.length > 8 && (
                    <input
                      type="text"
                      value={pairingFilter}
                      onChange={(e) => setPairingFilter(e.target.value)}
                      placeholder="搜尋（題號或頁數）"
                      className="w-full h-7 px-2 rounded border border-rule-2 text-[11px]"
                    />
                  )}

                  <select
                    value={pairingQNum ?? ""}
                    onChange={(e) => setPairingQNum(e.target.value ? Number(e.target.value) : null)}
                    size={Math.min(8, Math.max(3, bookQuestions.length))}
                    className="w-full px-2 rounded border border-rule-2 text-[12px]"
                  >
                    {(() => {
                      const f = pairingFilter.trim();
                      const filtered = !f
                        ? bookQuestions
                        : bookQuestions.filter((q) =>
                            String(q.question_number).includes(f) ||
                            String(q.page_number ?? "").includes(f),
                          );
                      if (filtered.length === 0) {
                        return <option disabled>沒有符合的題</option>;
                      }
                      return filtered.map((q) => (
                        <option key={q.question_number} value={q.question_number}>
                          Q{q.question_number}（第 {q.page_number} 頁）
                        </option>
                      ));
                    })()}
                  </select>

                  {pairingQ && pairingQ.page_id !== page.id && (
                    <button
                      onClick={() => router.push(`/book/${book.id}/page/${pairingQ.page_id}`)}
                      className="w-full px-2 py-1 rounded border border-rule-2 text-[11px] text-ink-3 hover:bg-rule/40"
                    >
                      🔍 跳到 Q{pairingQNum} 所在的第 {pairingQ.page_number} 頁
                    </button>
                  )}

                  <label className="flex items-center gap-1.5 text-[11px] text-ink-3 pt-1">
                    <input
                      type="checkbox"
                      checked={autoAdvance}
                      onChange={(e) => setAutoAdvance(e.target.checked)}
                      className="w-3.5 h-3.5"
                    />
                    畫完一格自動跳下一題
                  </label>

                  <div className="text-[10px] text-ink-3 pt-1 border-t border-rule">
                    畫的下個框會綁定 <span className="text-ink font-semibold">Q{pairingQNum ?? "—"}</span>
                  </div>
                </>
              )}
            </div>
          )}
          {pass === "question" && (
            <div className="text-[11px] text-ink-3 space-y-1">
              <div>
                下個 <span className="text-ann-question font-semibold">題幹</span> 自動編號{" "}
                <span className="text-ink font-semibold">Q{nextQuestionNumber}</span>
              </div>
              {currentQInPass != null && (
                <div>
                  選項/答案/詳解會綁{" "}
                  <span className="text-ink font-semibold">Q{currentQInPass}</span>
                  <button
                    onClick={() => setCurrentQInPass(null)}
                    className="ml-2 text-[10px] text-ink-3 underline hover:text-ink"
                  >
                    重設
                  </button>
                </div>
              )}
              {currentQInPass == null && (
                <div className="text-ink-4">
                  （先標一個題幹，後面同題的選項/答案/詳解會自動配對）
                </div>
              )}
            </div>
          )}

          {selected && (
            <SelectedPanel
              box={selected}
              onPatch={patchBox}
              onDelete={() => deleteBox(selected.id)}
            />
          )}

          <div className="border-t border-rule pt-3 mt-2 space-y-2">
            <button
              onClick={verifyPage}
              disabled={busy}
              className="w-full h-9 rounded-md bg-good text-white text-[13px]"
            >
              ✓ 確認此頁標完 (Enter)
            </button>
            <button
              onClick={skipPage}
              disabled={busy}
              className="w-full h-9 rounded-md border border-rule-2 text-[13px] text-ink-3"
            >
              略過此頁 (目錄/版權頁)
            </button>
          </div>

          <div className="text-[11px] text-ink-3 border-t border-rule pt-3 mt-2 space-y-1">
            <div className="font-medium text-ink-2 mb-1">快捷鍵</div>
            <div>Q/O/A/S/F/X/U — 切類型</div>
            <div>1/2/3 — 設選中題的難易度（簡單/中等/困難）</div>
            <div>Tab — 切換 題目/答案 Pass</div>
            <div>Enter — 此頁確認完，跳下一頁</div>
            <div>Alt + ← / → — 上一頁／下一頁（不改狀態）</div>
            <div>Delete — 刪除選中框</div>
            <div>Esc — 取消選擇</div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Tiny preview of a question cropped from its source page PNG. Loads the
 *  page image once via Supabase Storage and uses CSS positioning to show
 *  only the bbox region — no canvas needed. */
function QuestionPreview({
  q,
}: {
  q: {
    page_id: string;
    page_png_path?: string;
    page_width?: number;
    page_height?: number;
    bbox: { x: number; y: number; w: number; h: number };
  };
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!q.page_png_path) return;
    let cancelled = false;
    let objUrl: string | null = null;
    (async () => {
      const { data } = await supabase().storage.from(BUCKET).download(q.page_png_path!);
      if (cancelled || !data) return;
      objUrl = URL.createObjectURL(data);
      setSrc(objUrl);
    })();
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [q.page_png_path]);

  if (!q.page_width || !q.page_height) return null;

  // Render at 220px wide; height keeps the bbox aspect ratio.
  const dispW = 220;
  const dispH = Math.round(dispW * (q.bbox.h / q.bbox.w));
  // CSS trick: the image is positioned and scaled so that q.bbox covers the
  // visible div (overflow: hidden clips the rest).
  const scaleFactor = dispW / q.bbox.w;

  return (
    <div
      className="relative overflow-hidden border border-rule-2 rounded bg-white mx-auto"
      style={{ width: dispW, height: dispH }}
    >
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-3">
          載入縮圖…
        </div>
      )}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          style={{
            position: "absolute",
            left: -q.bbox.x * scaleFactor,
            top: -q.bbox.y * scaleFactor,
            width: q.page_width * scaleFactor,
            height: q.page_height * scaleFactor,
            maxWidth: "none",
          }}
        />
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-ink-3 mt-1">{children}</div>;
}

function SelectedPanel({
  box, onPatch, onDelete,
}: {
  box: Box;
  onPatch: (id: string, patch: Partial<Box>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="border border-rule-2 rounded p-3 space-y-2 bg-rule/20">
      <div className="text-[10px] uppercase tracking-wider text-ink-3">已選 {BOX_TYPE_INFO[box.type].label}</div>

      <label className="block text-[11px] text-ink-3">題號</label>
      <input
        type="number"
        value={box.question_number ?? ""}
        onChange={(e) => onPatch(box.id, { question_number: e.target.value ? Number(e.target.value) : null })}
        className="w-full h-8 px-2 rounded border border-rule-2 text-[13px]"
      />

      {box.type === "option" && (
        <>
          <label className="block text-[11px] text-ink-3">選項字母</label>
          <select
            value={box.option_letter ?? ""}
            onChange={(e) => onPatch(box.id, { option_letter: e.target.value || null })}
            className="w-full h-8 px-2 rounded border border-rule-2 text-[13px]"
          >
            <option value="">—</option>
            {["A","B","C","D","E"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </>
      )}

      {box.type === "question" && (
        <>
          <label className="block text-[11px] text-ink-3">難易度 (1/2/3)</label>
          <div className="flex gap-1">
            {(["easy","medium","hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => onPatch(box.id, { difficulty: d })}
                className={
                  "flex-1 px-2 py-1 rounded text-[12px] border " +
                  (box.difficulty === d ? "bg-ink text-paper border-ink" : "bg-paper text-ink-2 border-rule-2")
                }
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
        </>
      )}

      <button
        onClick={onDelete}
        className="w-full h-8 rounded border border-danger text-danger text-[12px] mt-2"
      >
        刪除這個框
      </button>
    </div>
  );
}
