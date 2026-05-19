"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Stage, Layer, Image as KImage, Rect, Text, Group, Transformer } from "react-konva";
import type Konva from "konva";
import { supabase } from "@/lib/supabase";

const BUCKET = "annotation-source";
const DEFAULT_OPTION_LETTER = "ABCD";
import {
  Box, BoxType, Difficulty, Page, Book,
  BOX_TYPE_INFO, DIFFICULTY_LABEL,
} from "@/lib/types";
import { NameModal } from "./NameModal";

// Of all boxes carrying a question_number on this page, return the one
// whose AABB intersects the given bbox the most (by area). Returns null
// if none overlap. Drawing a new box on top of an existing labeled box
// — regardless of type — inherits that box's question_number +
// sub_number. This generalizes the "stem → its options/answers" pairing
// to any stack-on-top relationship the annotator draws.
function findUnderlyingBox(
  bbox: { x: number; y: number; w: number; h: number },
  boxes: Box[],
): Box | null {
  let best: Box | null = null;
  let bestArea = 0;
  for (const b of boxes) {
    if (b.question_number == null) continue;
    const ix = Math.max(
      0,
      Math.min(bbox.x + bbox.w, b.bbox.x + b.bbox.w) - Math.max(bbox.x, b.bbox.x),
    );
    const iy = Math.max(
      0,
      Math.min(bbox.y + bbox.h, b.bbox.y + b.bbox.h) - Math.max(bbox.y, b.bbox.y),
    );
    const area = ix * iy;
    if (area > bestArea) {
      bestArea = area;
      best = b;
    }
  }
  return bestArea > 0 ? best : null;
}

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
  const [userId, setUserId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  // Map of box id → Konva Rect node, populated via ref={} so Transformer
  // can attach to whichever box is currently selected.
  const rectRefs = useRef<Map<string, Konva.Rect>>(new Map());

  // Cross-page pairing for answer pass.
  // bookQuestions = every type=question box in this book (for the dropdown).
  // pairingQNum = which Q the next-drawn answer/solution box gets paired with.
  // autoAdvance = after saving, jump to the next unpaired Q automatically.
  type BookQ = {
    id: string;
    question_number: number;
    page_id: string;
    bbox: { x: number; y: number; w: number; h: number };
    difficulty?: Difficulty | null;
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
  // Persisted to localStorage per-book so it survives page navigation.
  const [currentQInPass, setCurrentQInPass] = useState<number | null>(null);
  // Companion sticky for 題組 sub_number (e.g., Q6 sub=2 means 「第 6 題的
  // 第 (2) 小題」). Same persistence pattern.
  const [currentSubInPass, setCurrentSubInPass] = useState<number | null>(null);
  const [lastOptionLetter, setLastOptionLetter] = useState(DEFAULT_OPTION_LETTER);
  // Hydrate Q + sub stickies from localStorage when book loads.
  useEffect(() => {
    if (typeof window === "undefined" || !params.id) return;
    const q = localStorage.getItem(`label.stickyQ.${params.id}`);
    const s = localStorage.getItem(`label.stickySub.${params.id}`);
    const optionLetter = localStorage.getItem(`label.stickyOptionLetter.${params.id}`);
    setCurrentQInPass(q ? Number(q) : null);
    setCurrentSubInPass(s ? Number(s) : null);
    setLastOptionLetter(optionLetter || DEFAULT_OPTION_LETTER);
  }, [params.id]);
  // Persist whenever they change.
  useEffect(() => {
    if (typeof window === "undefined" || !params.id) return;
    if (currentQInPass == null) {
      localStorage.removeItem(`label.stickyQ.${params.id}`);
    } else {
      localStorage.setItem(`label.stickyQ.${params.id}`, String(currentQInPass));
    }
  }, [params.id, currentQInPass]);
  useEffect(() => {
    if (typeof window === "undefined" || !params.id) return;
    if (currentSubInPass == null) {
      localStorage.removeItem(`label.stickySub.${params.id}`);
    } else {
      localStorage.setItem(`label.stickySub.${params.id}`, String(currentSubInPass));
    }
  }, [params.id, currentSubInPass]);
  useEffect(() => {
    if (typeof window === "undefined" || !params.id) return;
    localStorage.setItem(`label.stickyOptionLetter.${params.id}`, lastOptionLetter || DEFAULT_OPTION_LETTER);
  }, [params.id, lastOptionLetter]);

  useEffect(() => {
    if (!annotatorName) return;
    let cancelled = false;
    supabase().auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [annotatorName]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSyncError = (event: Event) => {
      setSyncError((event as CustomEvent<string>).detail);
    };
    window.addEventListener("label-sync-error", onSyncError as EventListener);
    const lastError = localStorage.getItem("label.lastSyncError");
    if (lastError) {
      setSyncError(lastError);
      localStorage.removeItem("label.lastSyncError");
    }
    return () => {
      window.removeEventListener("label-sync-error", onSyncError as EventListener);
    };
  }, [params.pageId]);

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

  // Separate auto-increment for 單元概念 (unit_title) — concept index runs
  // independently of question-stem index. Drawing a unit_title doesn't
  // touch currentQInPass either (concepts aren't part of a question chain).
  const [bookUnitTitleMax, setBookUnitTitleMax] = useState(0);
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase()
        .from("annotation_boxes")
        .select("question_number")
        .eq("book_id", book.id)
        .eq("type", "unit_title")
        .not("question_number", "is", null);
      if (cancelled) return;
      const max = ((data as any[]) ?? []).reduce(
        (m, r) => Math.max(m, r.question_number ?? 0),
        0,
      );
      setBookUnitTitleMax(max);
    })();
    return () => {
      cancelled = true;
    };
  }, [book, boxes]);
  const nextUnitTitleNumber = bookUnitTitleMax + 1;

  // Fetch every question box for the book — used by the answer-pass dropdown.
  // Includes the source page's page_number for the "Q3 (第 X 頁)" hint.
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase()
        .from("annotation_boxes")
        .select("id, question_number, page_id, bbox, difficulty, page:annotation_pages(page_number, png_path, width, height)")
        .eq("book_id", book.id)
        .eq("type", "question")
        .not("question_number", "is", null)
        .order("question_number")
        .order("id", { ascending: true }); // deterministic tie-break when duplicate stems exist
      if (cancelled) return;
      const flat: BookQ[] = ((data as any[]) ?? [])
        .map((r) => ({
          id: r.id,
          question_number: r.question_number,
          page_id: r.page_id,
          bbox: r.bbox,
          difficulty: r.difficulty,
          page_number: r.page?.page_number,
          page_png_path: r.page?.png_path,
          page_width: r.page?.width,
          page_height: r.page?.height,
        }));
      // Dedup by question_number. Duplicates happen when a stem is re-drawn;
      // keep the first box but adopt a difficulty from whichever duplicate
      // has one set — difficulty is authored on the stem and re-drawn copies
      // are often left blank.
      const byNum = new Map<number, BookQ>();
      for (const q of flat) {
        const existing = byNum.get(q.question_number);
        if (!existing) {
          byNum.set(q.question_number, q);
        } else if (!existing.difficulty && q.difficulty) {
          byNum.set(q.question_number, { ...existing, difficulty: q.difficulty });
        }
      }
      setBookQuestions([...byNum.values()]);
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
      const created_by = userId;

      // Question-number resolution rules:
      //   answer pass         → use pairingQNum (the dropdown choice)
      //   question pass:
      //     type=question     → auto-increment book-wide IF no sticky sub-
      //                         number, OR keep same Q if labeling sub-question
      //                         (sticky sub indicates 題組 in progress).
      //                         Mark as "currentQ" sticky.
      //     other types       → inherit from currentQInPass + currentSubInPass.
      let qnum: number | null = null;
      let snum: number | null = null;
      let nextCurrentQ = currentQInPass;
      let nextCurrentSub = currentSubInPass;
      if (pass === "answer") {
        qnum = pairingQNum;
        snum = currentSubInPass;
      } else if (activeType === "question") {
        // If user explicitly entered a pendingNumber, use that. Otherwise
        // auto-increment OR keep same Q if we're mid-題組 with sticky sub.
        qnum = pendingNumber ?? nextQuestionNumber;
        snum = null; // main stem of a new Q resets sub
        nextCurrentQ = qnum;
        nextCurrentSub = null;
      } else if (activeType === "unit_title") {
        // 單元概念 has its own counter (independent of question chain).
        // Doesn't touch sticky Q — drawing a concept mid-Q5 shouldn't
        // reset the Q5 chain that subsequent options/answers should pair to.
        qnum = pendingNumber ?? nextUnitTitleNumber;
        snum = null;
      } else {
        qnum = currentQInPass;
        snum = currentSubInPass;
      }

      // Overlap inheritance: if the new box overlaps any existing labeled
      // box on this page, adopt that box's question_number + sub_number.
      // Picks the largest-intersection one when several overlap. Applies
      // to every type — including question itself — so re-drawing a stem
      // on top of an existing one keeps its number rather than auto-
      // incrementing into a gap.
      const overlap = findUnderlyingBox(bbox, boxes);
      if (overlap) {
        qnum = overlap.question_number;
        snum = overlap.sub_number;
        if (activeType === "question") {
          // Stem inherited a number → keep sticky chain on that number.
          nextCurrentQ = qnum;
          nextCurrentSub = snum;
        }
      }

      const { data, error } = await sb
        .from("annotation_boxes")
        .insert({
          page_id: page.id,
          book_id: book.id,
          type: activeType,
          bbox,
          question_number: qnum,
          sub_number: snum,
          option_letter: activeType === "option" ? (lastOptionLetter || DEFAULT_OPTION_LETTER) : null,
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
      // Update sticky Q-number / sub-number for question pass.
      if (nextCurrentQ !== currentQInPass) setCurrentQInPass(nextCurrentQ);
      if (nextCurrentSub !== currentSubInPass) setCurrentSubInPass(nextCurrentSub);

      // Auto-advance to next Q in answer pass when toggle is on.
      if (pass === "answer" && autoAdvance) {
        advancePairingQ(1);
      }
    },
    [page, book, annotatorName, activeType, pendingNumber, nextQuestionNumber, nextUnitTitleNumber, pass, pairingQNum, autoAdvance, advancePairingQ, currentQInPass, currentSubInPass, boxes, userId, lastOptionLetter],
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
    const updated = data as Box;
    setBoxes((bs) => bs.map((b) => (b.id === id ? updated : b)));
    if (selected?.id === id) setSelected(updated);
    // Keep bookQuestions in sync when patching a question box from another page
    // (boxes only holds current-page boxes, so bookQuestions would otherwise stay stale)
    if ("difficulty" in patch) {
      setBookQuestions((bqs) => bqs.map((q) => q.id === id ? { ...q, difficulty: updated.difficulty } : q));
    }
  }, [selected]);

  useEffect(() => {
    if (selected?.type !== "option" || selected.option_letter) return;
    void patchBox(selected.id, { option_letter: lastOptionLetter || DEFAULT_OPTION_LETTER });
  }, [selected?.id, selected?.type, selected?.option_letter, lastOptionLetter, patchBox]);

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

  const markPageAndMove = useCallback((status: "human_verified" | "skipped") => {
    if (!page || !book || busy) return;
    setBusy(true);

    const patch = {
      status,
      verified_by: userId,
      verified_by_name: annotatorName,
      verified_at: new Date().toISOString(),
    };

    setSyncError(null);
    setPage((p) => (p?.id === page.id ? { ...p, ...patch } : p));
    setAllPages((ps) => ps.map((p) => (p.id === page.id ? { ...p, ...patch } : p)));

    const idx = allPages.findIndex((p) => p.id === page.id);
    const next = allPages.slice(idx + 1).find(
      (p) => p.status !== "human_verified" && p.status !== "skipped",
    );

    if (next) router.push(`/book/${book!.id}/page/${next.id}`);
    else router.push(`/book/${book!.id}`);

    void supabase()
      .from("annotation_pages")
      .update(patch)
      .eq("id", page.id)
      .then(({ error }) => {
        if (error) {
          const message = `本頁同步失敗：${error.message}`;
          console.error(message);
          localStorage.setItem("label.lastSyncError", message);
          window.dispatchEvent(new CustomEvent("label-sync-error", { detail: message }));
        }
      });
  }, [page, allPages, book, annotatorName, router, userId, busy]);

  // Mark page verified + jump immediately; DB write continues in background.
  const verifyPage = useCallback(() => {
    markPageAndMove("human_verified");
  }, [markPageAndMove]);

  // Mark page skipped (e.g., TOC, copyright, blank).
  const skipPage = useCallback(() => {
    markPageAndMove("skipped");
  }, [markPageAndMove]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!annotatorName) return;
    const onKey = (e: KeyboardEvent) => {
      // Letter shortcuts to set type
      const map: Record<string, BoxType> = {
        q: "question", w: "option", a: "answer",
        s: "solution", d: "figure", x: "skip", e: "unit_title",
      };
      if (e.key.toLowerCase() in map) {
        setActiveType(map[e.key.toLowerCase()]);
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

  // Attach the Konva Transformer to the currently selected box's Rect node.
  // Transformer renders 8 resize handles + lets the user drag the rect to
  // move it. Detach when nothing is selected.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (selected) {
      const node = rectRefs.current.get(selected.id);
      if (node) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
        return;
      }
    }
    tr.nodes([]);
    tr.getLayer()?.batchDraw();
  }, [selected, boxes]);

  const stemDiffByQNum = useMemo(() => {
    const m = new Map<number, Difficulty | null>();
    for (const q of bookQuestions) {
      if (!m.has(q.question_number)) m.set(q.question_number, q.difficulty ?? null);
    }
    return m;
  }, [bookQuestions]);

  if (!annotatorName) return <NameModal onReady={setReady} />;
  if (!book || !page) return <div className="p-10 text-ink-3">載入中…</div>;

  // Stage handlers
  const stagePos = (e: any) => {
    const stage = e.target.getStage();
    const ptr = stage.getPointerPosition();
    return { x: ptr.x / scale, y: ptr.y / scale };
  };

  const onMouseDown = (e: any) => {
    // Skip if click landed on an existing rect AND Shift is NOT held.
    // Shift+drag overrides — used when the new box should overlap an existing
    // one (e.g., 圖片 inside a 單元概念 region).
    const isOnRect = e.target !== e.target.getStage();
    const shift = e.evt?.shiftKey;
    if (isOnRect && !shift) return;
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

  const pageDifficultyStats = questionDifficultyStats(boxes);
  const bookDifficultyStats = questionDifficultyStats(bookQuestions);
  const selectedLinkedQuestion =
    selected?.question_number != null
      ? bookQuestions.find((q) => q.question_number === selected.question_number) ?? null
      : null;
  const crossPagePairingQ =
    selected?.question_number ?? pairingQNum ?? currentQInPass ?? null;

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
                      <Group key={b.id}>
                        <Rect
                          ref={(node) => {
                            if (node) rectRefs.current.set(b.id, node);
                            else rectRefs.current.delete(b.id);
                          }}
                          x={b.bbox.x}
                          y={b.bbox.y}
                          width={b.bbox.w}
                          height={b.bbox.h}
                          stroke={color}
                          strokeWidth={isSelected ? 4 : 2}
                          fill={`${color}1A`}
                          draggable={isSelected}
                          // Click on rect → select it (cancel bubble so Stage's
                          // onMouseDown doesn't start a fresh draw).
                          // Holding Shift bypasses selection so user can draw
                          // a new (overlapping) box on top of this one.
                          onMouseDown={(e) => {
                            if (e.evt?.shiftKey) {
                              // step out of the way: stop the drag that
                              // draggable={isSelected} may have auto-started.
                              try { (e.target as any).stopDrag?.(); } catch {}
                              return;
                            }
                            e.cancelBubble = true;
                            setSelected(b);
                          }}
                          onTap={(e) => {
                            e.cancelBubble = true;
                            setSelected(b);
                          }}
                          // If shift is held when drag starts, abort — Stage's
                          // onMouseDown wants to start a draw instead.
                          onDragStart={(e) => {
                            if (e.evt?.shiftKey) {
                              (e.target as any).stopDrag?.();
                            }
                          }}
                          // Drag = move (only when selected via draggable above).
                          onDragEnd={(e) => {
                            const node = e.target;
                            patchBox(b.id, {
                              bbox: {
                                x: Math.round(node.x()),
                                y: Math.round(node.y()),
                                w: Math.round(b.bbox.w),
                                h: Math.round(b.bbox.h),
                              },
                            });
                          }}
                          // Resize via Transformer handles → bake the scale
                          // back into width/height + reset scale to 1.
                          onTransformEnd={(e) => {
                            const node = e.target as Konva.Rect;
                            const sx = node.scaleX();
                            const sy = node.scaleY();
                            const newW = Math.max(8, Math.round(node.width() * sx));
                            const newH = Math.max(8, Math.round(node.height() * sy));
                            node.scaleX(1);
                            node.scaleY(1);
                            node.width(newW);
                            node.height(newH);
                            patchBox(b.id, {
                              bbox: {
                                x: Math.round(node.x()),
                                y: Math.round(node.y()),
                                w: newW,
                                h: newH,
                              },
                            });
                          }}
                        />
                        <Text
                          x={b.bbox.x + 4}
                          y={b.bbox.y + 4}
                          text={(() => {
                            const d = b.question_number != null
                              ? stemDiffByQNum.get(b.question_number) ?? null
                              : b.difficulty;
                            return (
                              BOX_TYPE_INFO[b.type].label +
                              (b.question_number != null ? ` Q${b.question_number}` : "") +
                              (b.option_letter ? ` (${b.option_letter})` : "") +
                              (d ? ` ${DIFFICULTY_LABEL[d]}` : "")
                            );
                          })()}
                          fontSize={14}
                          fontStyle="bold"
                          fill={color}
                          listening={false}
                        />
                      </Group>
                    );
                  })}
                  {/* Transformer renders 8 resize handles + edge lines for the
                      currently selected box. boundBoxFunc enforces a minimum size. */}
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled={false}
                    keepRatio={false}
                    enabledAnchors={[
                      "top-left", "top-center", "top-right",
                      "middle-left", "middle-right",
                      "bottom-left", "bottom-center", "bottom-right",
                    ]}
                    anchorSize={10}
                    anchorStroke="#1A1A1A"
                    anchorFill="#FFFFFF"
                    borderStroke="#1A1A1A"
                    borderStrokeWidth={1}
                    boundBoxFunc={(_oldBox, newBox) => {
                      if (newBox.width < 10 || newBox.height < 10) return _oldBox;
                      return newBox;
                    }}
                  />
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
          {syncError && (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-[12px] leading-5 text-danger">
              <div className="font-semibold">同步提醒</div>
              <div>{syncError}</div>
              <button
                onClick={() => setSyncError(null)}
                className="mt-2 text-[11px] underline"
              >
                關閉
              </button>
            </div>
          )}
          <div className="rounded-md border border-rule-2 bg-[#fffdf8] p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              難度標註進度
            </div>
            <div className="grid grid-cols-2 gap-2">
              <DifficultyStat label="本頁題目" stats={pageDifficultyStats} />
              <DifficultyStat label="全書題目" stats={bookDifficultyStats} />
            </div>
          </div>
          <SectionTitle>類型 (Q W A S D X E)</SectionTitle>
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

          {crossPagePairingQ != null && (
            <button
              onClick={() =>
                window.open(
                  `/book/${book.id}/pairing?q=${crossPagePairingQ}&page=${page.id}`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
              className="h-9 rounded-md border border-accent bg-accent/10 text-[12px] font-semibold text-accent hover:bg-accent/15"
            >
              開新分頁配對 Q{crossPagePairingQ}
            </button>
          )}

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
              {activeType === "unit_title" && (
                <div>
                  下個 <span className="text-ann-unit font-semibold">單元概念</span> 自動編號{" "}
                  <span className="text-ink font-semibold">第 {nextUnitTitleNumber}</span>
                </div>
              )}
              {currentQInPass != null && (
                <div>
                  選項/答案/詳解會綁{" "}
                  <span className="text-ink font-semibold">
                    Q{currentQInPass}
                    {currentSubInPass != null && <span>-({currentSubInPass})</span>}
                  </span>
                  <button
                    onClick={() => { setCurrentQInPass(null); setCurrentSubInPass(null); }}
                    className="ml-2 text-[10px] text-ink-3 underline hover:text-ink"
                  >
                    重設
                  </button>
                </div>
              )}
              {/* 題組工具：在 sticky Q 還在的時候，可手動撥到子題 */}
              {currentQInPass != null && (
                <div className="flex items-center gap-1 pt-1">
                  <span className="text-[10px] text-ink-3">題組（子題號）：</span>
                  <button
                    onClick={() =>
                      setCurrentSubInPass((s) => (s == null ? 1 : Math.max(0, s - 1)))
                    }
                    className="px-1.5 py-0.5 rounded border border-rule-2 text-[10px]"
                  >
                    −
                  </button>
                  <span className="text-[10px] text-ink font-mono w-8 text-center">
                    {currentSubInPass ?? "—"}
                  </span>
                  <button
                    onClick={() =>
                      setCurrentSubInPass((s) => (s == null ? 1 : s + 1))
                    }
                    className="px-1.5 py-0.5 rounded border border-rule-2 text-[10px]"
                  >
                    +
                  </button>
                  <button
                    onClick={() => setCurrentSubInPass(null)}
                    className="px-1.5 py-0.5 rounded border border-rule-2 text-[10px] text-ink-3"
                  >
                    清除
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
              linkedQuestion={selectedLinkedQuestion}
              onPatch={patchBox}
              lastOptionLetter={lastOptionLetter}
              onOptionLetterChange={setLastOptionLetter}
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
            <div>Q/O/A/S/D/X/E — 切類型</div>
            <div>Tab — 切換 題目/答案 Pass</div>
            <div>Enter — 此頁確認完，跳下一頁</div>
            <div>Alt + ← / → — 上一頁／下一頁（不改狀態）</div>
            <div className="text-ink font-medium">Shift + 拖拉 — 在既有框上重疊畫新框</div>
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

type DifficultyStats = {
  total: number;
  tagged: number;
  easy: number;
  medium: number;
  hard: number;
};

function questionDifficultyStats(
  rows: Array<{
    id: string;
    type?: BoxType;
    question_number?: number | null;
    difficulty?: Difficulty | null;
  }>,
): DifficultyStats {
  const byQuestion = new Map<string, Difficulty | null>();
  for (const row of rows) {
    if (row.type && row.type !== "question") continue;
    const key = row.question_number != null ? `q:${row.question_number}` : `id:${row.id}`;
    const current = byQuestion.get(key) ?? null;
    byQuestion.set(key, current ?? row.difficulty ?? null);
  }

  const stats: DifficultyStats = { total: byQuestion.size, tagged: 0, easy: 0, medium: 0, hard: 0 };
  for (const difficulty of byQuestion.values()) {
    if (!difficulty) continue;
    stats.tagged += 1;
    stats[difficulty] += 1;
  }
  return stats;
}

function DifficultyStat({ label, stats }: { label: string; stats: DifficultyStats }) {
  return (
    <div className="rounded-md border border-rule bg-paper p-2">
      <div className="text-[11px] font-semibold text-ink-3">{label}</div>
      <div className="mt-1 text-[22px] font-semibold text-ink">
        {stats.tagged}<span className="text-[12px] text-ink-3"> / {stats.total}</span>
      </div>
      <div className="mt-1 text-[10px] leading-5 text-ink-3">
        已標難度
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-3">
        <span>簡 {stats.easy}</span>
        <span>中 {stats.medium}</span>
        <span>難 {stats.hard}</span>
      </div>
    </div>
  );
}

function SelectedPanel({
  box, linkedQuestion, onPatch, lastOptionLetter, onOptionLetterChange, onDelete,
}: {
  box: Box;
  linkedQuestion: { id: string; question_number: number; difficulty?: Difficulty | null } | null;
  onPatch: (id: string, patch: Partial<Box>) => void;
  lastOptionLetter: string;
  onOptionLetterChange: (value: string) => void;
  onDelete: () => void;
}) {
  const canGuideDifficulty = box.type === "answer";
  const needsDifficultyGuide =
    canGuideDifficulty && box.question_number != null && !!linkedQuestion;

  return (
    <div className="border border-rule-2 rounded p-3 space-y-2 bg-rule/20">
      <div className="text-[10px] uppercase tracking-wider text-ink-3">已選 {BOX_TYPE_INFO[box.type].label}</div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-ink-3">題號</label>
          <input
            type="number"
            value={box.question_number ?? ""}
            onChange={(e) => onPatch(box.id, { question_number: e.target.value ? Number(e.target.value) : null })}
            className="w-full h-8 px-2 rounded border border-rule-2 text-[13px]"
          />
        </div>
        <div>
          <label className="block text-[11px] text-ink-3">子題（選填）</label>
          <input
            type="number"
            placeholder="1, 2, 3..."
            value={box.sub_number ?? ""}
            onChange={(e) => onPatch(box.id, { sub_number: e.target.value ? Number(e.target.value) : null })}
            className="w-full h-8 px-2 rounded border border-rule-2 text-[13px]"
          />
        </div>
      </div>
      {box.sub_number != null && (
        <div className="text-[10px] text-ink-3 -mt-1">
          題組標記：第 {box.question_number} 題的第 ({box.sub_number}) 小題
        </div>
      )}

      {box.type === "unit_title" && (
        <div className="rounded-md border border-ann-unit/30 bg-ann-unit/10 p-2 text-[11px] leading-5 text-ink-3">
          單元概念只用來標知識點或章節概念，不設定簡單 / 中等 / 困難。
        </div>
      )}

      {needsDifficultyGuide && linkedQuestion && (
        <div className="rounded-md border-2 border-warn bg-warn/10 p-3 shadow-[0_0_0_3px_rgba(204,137,0,0.10)]">
          <div className="text-[11px] font-semibold text-warn">
            已設定 {BOX_TYPE_INFO[box.type].label} Q{box.question_number}，下一步請補這題難度
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(["easy","medium","hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => onPatch(linkedQuestion.id, { difficulty: d })}
                className={
                  "h-9 rounded border text-[12px] font-semibold transition-colors " +
                  (linkedQuestion.difficulty === d
                    ? "border-ink bg-ink text-paper"
                    : "border-rule-2 bg-paper text-ink-2 hover:bg-rule/40")
                }
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[10px] leading-5 text-ink-3">
            這會寫回 Q{box.question_number} 的題幹難度，答案框本身不另外記難度。
          </div>
        </div>
      )}

      {canGuideDifficulty && box.question_number != null && !linkedQuestion && (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] leading-5 text-warn">
          這個框有 Q{box.question_number}，但目前找不到對應題幹框；請先建立或修正題幹 Q{box.question_number}，再設定難度。
        </div>
      )}

      {box.type === "option" && (
        <>
          <label className="block text-[11px] text-ink-3">
            選項字母 / 群組
            <span className="block text-[10px] text-ink-4">
              單個（A）= 一框一選項；群組（ABCD）= 一框含所有選項，AI 抽取時自動拆
            </span>
          </label>
          <select
            value={box.option_letter || lastOptionLetter || DEFAULT_OPTION_LETTER}
            onChange={(e) => {
              const value = e.target.value || DEFAULT_OPTION_LETTER;
              onOptionLetterChange(value);
              onPatch(box.id, { option_letter: value });
            }}
            className="w-full h-8 px-2 rounded border border-rule-2 text-[13px]"
          >
            <optgroup label="單個選項">
              {["A","B","C","D","E","F"].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </optgroup>
            <optgroup label="群組（一框多選項）">
              <option value="ABC">ABC（3 選項）</option>
              <option value="ABCD">ABCD（4 選項）</option>
              <option value="ABCDE">ABCDE（5 選項）</option>
              <option value="ABCDEF">ABCDEF（6 選項）</option>
              <option value="123">123（3 選項，數字編號）</option>
              <option value="1234">1234（4 選項，數字編號）</option>
              <option value="12345">12345（5 選項）</option>
              <option value="123456">123456（6 選項）</option>
            </optgroup>
          </select>
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
