"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Stage, Layer, Image as KImage, Rect, Text, Group, Transformer } from "react-konva";
import type Konva from "konva";
import { supabase } from "@/lib/supabase";
import {
  Book,
  Box,
  BoxType,
  Difficulty,
  Page,
  BOX_TYPE_INFO,
  DIFFICULTY_LABEL,
} from "@/lib/types";
import { NameModal } from "./NameModal";

const BUCKET = "annotation-source";
const PAIRING_TYPES: BoxType[] = ["answer", "solution", "option", "figure"];

type BookBox = Box & {
  page?: {
    page_number?: number;
    png_path?: string;
    width?: number;
    height?: number;
  } | null;
};

type QuestionBox = BookBox & {
  question_number: number;
};

export function CrossPagePairingView() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [annotatorName, setReady] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [allBoxes, setAllBoxes] = useState<BookBox[]>([]);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selected, setSelected] = useState<BookBox | null>(null);
  const [activeType, setActiveType] = useState<BoxType>("answer");
  const [targetQ, setTargetQ] = useState<number | null>(null);
  const [subNumber, setSubNumber] = useState<number | null>(null);
  const [pageFilter, setPageFilter] = useState("");
  const [qFilter, setQFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const stageWrapRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const rectRefs = useRef<Map<string, Konva.Rect>>(new Map());

  const loadAllBoxes = useCallback(async () => {
    // Paginate — PostgREST caps a single response at 1000 rows, and big
    // books have more boxes than that (the question list would otherwise
    // be silently truncated).
    const sb = supabase();
    const PAGE = 1000;
    const all: BookBox[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb
        .from("annotation_boxes")
        .select("*, page:annotation_pages(page_number, png_path, width, height)")
        .eq("book_id", params.id)
        .order("question_number", { ascending: true })
        .order("id", { ascending: true }) // deterministic tie-break when duplicate stems exist
        .range(from, from + PAGE - 1);
      const chunk = (data as BookBox[]) ?? [];
      all.push(...chunk);
      if (chunk.length < PAGE) break;
    }
    setAllBoxes(all);
  }, [params.id]);

  useEffect(() => {
    if (!annotatorName) return;
    const sb = supabase();
    Promise.all([
      sb.from("v_annotation_books").select("*").eq("id", params.id).single(),
      sb.from("annotation_pages").select("*").eq("book_id", params.id).order("page_number"),
    ]).then(([bookRes, pagesRes]) => {
      const loadedPages = (pagesRes.data as Page[]) ?? [];
      setBook(bookRes.data as Book | null);
      setPages(loadedPages);
      const pageFromUrl = searchParams.get("page");
      const firstPageId = loadedPages[0]?.id ?? null;
      setCurrentPageId(pageFromUrl && loadedPages.some((p) => p.id === pageFromUrl) ? pageFromUrl : firstPageId);
      loadAllBoxes();
    });
  }, [annotatorName, params.id, searchParams, loadAllBoxes]);

  useEffect(() => {
    if (!annotatorName) return;
    const channel = supabase()
      .channel(`cross-page-pairing:${params.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "annotation_boxes", filter: `book_id=eq.${params.id}` },
        () => loadAllBoxes(),
      )
      .subscribe();
    return () => {
      supabase().removeChannel(channel);
    };
  }, [annotatorName, params.id, loadAllBoxes]);

  useEffect(() => {
    setPage(pages.find((p) => p.id === currentPageId) ?? null);
    setSelected(null);
  }, [pages, currentPageId]);

  const questions = useMemo<QuestionBox[]>(() => {
    // Dedup by question_number. When a stem is re-drawn the duplicate is
    // often left without a difficulty, so keep the first box but adopt a
    // difficulty from whichever duplicate has one set.
    const byNum = new Map<number, QuestionBox>();
    for (const b of allBoxes) {
      if (b.type !== "question" || b.question_number == null) continue;
      const q = b as QuestionBox;
      const existing = byNum.get(q.question_number);
      if (!existing) {
        byNum.set(q.question_number, q);
      } else if (!existing.difficulty && q.difficulty) {
        byNum.set(q.question_number, { ...existing, difficulty: q.difficulty });
      }
    }
    return [...byNum.values()].sort((a, b) => a.question_number - b.question_number);
  }, [allBoxes]);

  useEffect(() => {
    const fromUrl = Number(searchParams.get("q"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) {
      setTargetQ(fromUrl);
      return;
    }
    if (targetQ == null && questions.length > 0) {
      setTargetQ(questions[0].question_number);
    }
  }, [searchParams, questions, targetQ]);

  const targetQuestion = useMemo(
    () => questions.find((q) => q.question_number === targetQ) ?? null,
    [questions, targetQ],
  );

  const pageBoxes = useMemo(
    () => allBoxes.filter((b) => b.page_id === page?.id),
    [allBoxes, page],
  );

  const targetBoxes = useMemo(
    () => allBoxes.filter((b) => b.question_number === targetQ),
    [allBoxes, targetQ],
  );

  const stemDiffByQNum = useMemo(() => {
    const m = new Map<number, Difficulty | null>();
    for (const q of questions) {
      m.set(q.question_number, q.difficulty ?? null);
    }
    return m;
  }, [questions]);

  const targetStatus = useMemo(() => {
    const count = (type: BoxType) => targetBoxes.filter((b) => b.type === type).length;
    return {
      question: count("question"),
      answer: count("answer"),
      solution: count("solution"),
      option: count("option"),
      figure: count("figure"),
      difficulty: targetQuestion?.difficulty ?? null,
    };
  }, [targetBoxes, targetQuestion]);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    let objUrl: string | null = null;
    setImg(null);
    setImgErr(null);
    (async () => {
      try {
        const { data, error } = await supabase().storage.from(BUCKET).download(page.png_path);
        if (error || !data) throw error ?? new Error("empty blob");
        if (cancelled) return;
        objUrl = URL.createObjectURL(data);
        const im = new window.Image();
        im.onload = () => {
          if (!cancelled) setImg(im);
        };
        im.onerror = () => {
          if (!cancelled) setImgErr("頁面圖片載入失敗");
        };
        im.src = objUrl;
      } catch (e: any) {
        if (!cancelled) setImgErr(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [page]);

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
  }, [selected, pageBoxes]);

  const replaceRoute = useCallback((nextQ: number | null, nextPageId: string | null) => {
    const qs = new URLSearchParams();
    if (nextQ != null) qs.set("q", String(nextQ));
    if (nextPageId) qs.set("page", nextPageId);
    router.replace(`/book/${params.id}/pairing?${qs.toString()}`);
  }, [params.id, router]);

  const setPairingQuestion = useCallback((q: number | null) => {
    setTargetQ(q);
    replaceRoute(q, currentPageId);
  }, [currentPageId, replaceRoute]);

  const setPairingPage = useCallback((pageId: string | null) => {
    setCurrentPageId(pageId);
    replaceRoute(targetQ, pageId);
  }, [replaceRoute, targetQ]);

  const moveQuestion = useCallback((delta: 1 | -1) => {
    if (questions.length === 0) return;
    const idx = questions.findIndex((q) => q.question_number === targetQ);
    const next = questions[Math.max(0, Math.min(questions.length - 1, idx + delta))] ?? questions[0];
    setPairingQuestion(next.question_number);
  }, [questions, targetQ, setPairingQuestion]);

  const movePage = useCallback((delta: 1 | -1) => {
    if (!page) return;
    const idx = pages.findIndex((p) => p.id === page.id);
    const next = pages[Math.max(0, Math.min(pages.length - 1, idx + delta))];
    if (next) setPairingPage(next.id);
  }, [page, pages, setPairingPage]);

  const patchBox = useCallback(async (id: string, patch: Partial<Box>) => {
    const { data, error } = await supabase()
      .from("annotation_boxes")
      .update(patch)
      .eq("id", id)
      .select("*, page:annotation_pages(page_number, png_path, width, height)")
      .single();
    if (error) {
      alert(`更新失敗：${error.message}`);
      return;
    }
    const updated = data as BookBox;
    setAllBoxes((bs) => bs.map((b) => (b.id === id ? updated : b)));
    if (selected?.id === id) setSelected(updated);
  }, [selected]);

  const deleteBox = useCallback(async (id: string) => {
    const { error } = await supabase().from("annotation_boxes").delete().eq("id", id);
    if (error) {
      alert(`刪除失敗：${error.message}`);
      return;
    }
    setAllBoxes((bs) => bs.filter((b) => b.id !== id));
    if (selected?.id === id) setSelected(null);
  }, [selected]);

  // Keyboard shortcuts — mirror the main annotator. W/A/S/D pick the box
  // type for the next-drawn pairing box; Delete removes the selected box.
  useEffect(() => {
    if (!annotatorName) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
        return;
      }
      const typeMap: Record<string, BoxType> = {
        w: "option", a: "answer", s: "solution", d: "figure",
      };
      const k = e.key.toLowerCase();
      if (k in typeMap) {
        setActiveType(typeMap[k]);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        deleteBox(selected.id);
        return;
      }
      if (e.key === "Escape") {
        setSelected(null);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annotatorName, selected, deleteBox]);

  const saveBox = useCallback(async (bbox: { x: number; y: number; w: number; h: number }) => {
    if (!book || !page || !annotatorName || targetQ == null) return;
    if (!targetQuestion) {
      alert(`找不到 Q${targetQ} 的題幹，請先在主標註頁建立題幹。`);
      return;
    }
    setBusy(true);
    const sb = supabase();
    const { data: userData } = await sb.auth.getUser();
    const { data, error } = await sb
      .from("annotation_boxes")
      .insert({
        page_id: page.id,
        book_id: book.id,
        type: activeType,
        bbox,
        question_number: targetQ,
        sub_number: subNumber,
        annotator_name: annotatorName,
        created_by: userData.user?.id ?? null,
        source: "human",
      })
      .select("*, page:annotation_pages(page_number, png_path, width, height)")
      .single();
    setBusy(false);
    if (error) {
      alert(`儲存失敗：${error.message}`);
      return;
    }
    const created = data as BookBox;
    setAllBoxes((bs) => [...bs, created]);
    setSelected(created);
  }, [activeType, annotatorName, book, page, subNumber, targetQ, targetQuestion]);

  const stagePos = (e: any) => {
    const stage = e.target.getStage();
    const ptr = stage.getPointerPosition();
    return { x: ptr.x / scale, y: ptr.y / scale };
  };

  const onMouseDown = (e: any) => {
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

  const filteredQuestions = useMemo(() => {
    const f = qFilter.trim();
    if (!f) return questions;
    return questions.filter((q) =>
      String(q.question_number).includes(f) ||
      String(q.page?.page_number ?? "").includes(f),
    );
  }, [questions, qFilter]);

  const filteredPages = useMemo(() => {
    const f = pageFilter.trim();
    if (!f) return pages;
    return pages.filter((p) => String(p.page_number).includes(f));
  }, [pages, pageFilter]);

  if (!annotatorName) return <NameModal onReady={setReady} />;
  if (!book || !page) return <div className="p-10 text-ink-3">載入跨頁配對工作台...</div>;

  return (
    <main className="min-h-screen bg-paper">
      <div className="border-b border-rule bg-paper">
        <div className="max-w-[1720px] mx-auto px-6 h-12 flex items-center gap-4">
          <Link href={`/book/${book.id}`} className="text-[13px] text-ink-3 hover:text-ink">← 回書本</Link>
          <div className="flex-1 serif text-[15px] truncate">{book.title}</div>
          <span className="rounded border border-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            跨頁配對
          </span>
          <button
            onClick={() => window.open(`/book/${book.id}/page/${page.id}`, "_blank", "noopener,noreferrer")}
            className="h-8 rounded border border-rule-2 px-3 text-[12px] hover:bg-rule/40"
          >
            開啟本頁標註
          </button>
          <span className="text-[11px] text-ink-3">標註人：{annotatorName}</span>
        </div>
      </div>

      <div className="max-w-[1720px] mx-auto px-6 py-4 grid grid-cols-12 gap-4">
        <aside className="col-span-2 space-y-3">
          <Panel title="目前題號">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => moveQuestion(-1)}
                className="h-8 w-9 rounded border border-rule-2 hover:bg-rule/40"
              >
                ←
              </button>
              <div className="flex-1 rounded border border-rule bg-white py-2 text-center">
                <div className="serif text-[28px] font-semibold text-ink">Q{targetQ ?? "-"}</div>
                <div className="text-[10px] text-ink-3">
                  題幹在 p.{targetQuestion?.page?.page_number ?? "?"}
                </div>
              </div>
              <button
                onClick={() => moveQuestion(1)}
                className="h-8 w-9 rounded border border-rule-2 hover:bg-rule/40"
              >
                →
              </button>
            </div>
            <input
              value={qFilter}
              onChange={(e) => setQFilter(e.target.value)}
              placeholder="搜尋題號 / 題幹頁"
              className="mt-2 h-8 w-full rounded border border-rule-2 px-2 text-[12px]"
            />
            <select
              value={targetQ ?? ""}
              onChange={(e) => setPairingQuestion(e.target.value ? Number(e.target.value) : null)}
              size={Math.min(10, Math.max(4, filteredQuestions.length))}
              className="mt-2 w-full rounded border border-rule-2 px-2 text-[12px]"
            >
              {filteredQuestions.map((q) => (
                <option key={q.id} value={q.question_number}>
                  Q{q.question_number}｜題幹 p.{q.page?.page_number ?? "?"}
                </option>
              ))}
            </select>
            {targetQuestion && (
              <button
                onClick={() => setPairingPage(targetQuestion.page_id)}
                className="mt-2 h-8 w-full rounded border border-rule-2 text-[12px] hover:bg-rule/40"
              >
                跳到題幹頁
              </button>
            )}
          </Panel>

          <Panel title="跳頁">
            <div className="flex gap-1.5">
              <button
                onClick={() => movePage(-1)}
                className="h-8 flex-1 rounded border border-rule-2 text-[12px] hover:bg-rule/40"
              >
                上一頁
              </button>
              <button
                onClick={() => movePage(1)}
                className="h-8 flex-1 rounded border border-rule-2 text-[12px] hover:bg-rule/40"
              >
                下一頁
              </button>
            </div>
            <input
              value={pageFilter}
              onChange={(e) => setPageFilter(e.target.value)}
              placeholder="搜尋頁碼"
              className="mt-2 h-8 w-full rounded border border-rule-2 px-2 text-[12px]"
            />
            <select
              value={page.id}
              onChange={(e) => setPairingPage(e.target.value)}
              size={Math.min(12, Math.max(5, filteredPages.length))}
              className="mt-2 w-full rounded border border-rule-2 px-2 text-[12px]"
            >
              {filteredPages.map((p) => (
                <option key={p.id} value={p.id}>
                  p.{p.page_number}
                </option>
              ))}
            </select>
          </Panel>
        </aside>

        <section className="col-span-7" ref={stageWrapRef}>
          <div className="mb-3 flex items-center justify-between rounded-md border border-rule-2 bg-[#fffdf8] px-3 py-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">目前頁面</div>
              <div className="serif text-[22px] font-semibold text-ink">p.{page.page_number}</div>
            </div>
            <div className="text-right text-[12px] text-ink-3">
              新框會自動掛到 <span className="font-semibold text-ink">Q{targetQ ?? "-"}</span>
              {subNumber != null && <span> - 子題 {subNumber}</span>}
            </div>
          </div>

          {img && (
            <div
              className="inline-block border border-rule-2 bg-white"
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
                  <KImage image={img} width={page.width} height={page.height} listening={false} />
                  {pageBoxes.map((b) => {
                    const color = BOX_TYPE_INFO[b.type].color;
                    const isSelected = selected?.id === b.id;
                    const isTarget = b.question_number === targetQ;
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
                          strokeWidth={isSelected ? 4 : isTarget ? 3 : 1.5}
                          opacity={isTarget ? 1 : 0.42}
                          fill={`${color}${isTarget ? "1F" : "0F"}`}
                          draggable={isSelected}
                          onMouseDown={(e) => {
                            if (e.evt?.shiftKey) {
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
                            return `${BOX_TYPE_INFO[b.type].label}${b.question_number != null ? ` Q${b.question_number}` : ""}${d ? ` ${DIFFICULTY_LABEL[d]}` : ""}`;
                          })()}
                          fontSize={14}
                          fontStyle="bold"
                          fill={color}
                          opacity={isTarget ? 1 : 0.55}
                          listening={false}
                        />
                      </Group>
                    );
                  })}
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
          {!img && !imgErr && <div className="p-10 text-ink-3">載入頁面圖片...</div>}
          {imgErr && <div className="p-10 text-danger text-[13px]">圖片載入失敗：{imgErr}</div>}
        </section>

        <aside className="col-span-3 space-y-3">
          <Panel title="要新增的框">
            <div className="grid grid-cols-2 gap-1.5">
              {PAIRING_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveType(t)}
                  className={
                    "h-9 rounded border text-[12px] font-semibold transition-colors " +
                    (activeType === t ? "text-white" : "border-rule-2 bg-paper text-ink-2 hover:bg-rule/40")
                  }
                  style={activeType === t ? { backgroundColor: BOX_TYPE_INFO[t].color, borderColor: BOX_TYPE_INFO[t].color } : undefined}
                >
                  {BOX_TYPE_INFO[t].label}
                  <span className="ml-1 text-[10px] opacity-60">{BOX_TYPE_INFO[t].key}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-ink-3">
                目標題號
                <input
                  type="number"
                  value={targetQ ?? ""}
                  onChange={(e) => setPairingQuestion(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 h-8 w-full rounded border border-rule-2 px-2 text-[13px]"
                />
              </label>
              <label className="text-[11px] text-ink-3">
                子題
                <input
                  type="number"
                  value={subNumber ?? ""}
                  onChange={(e) => setSubNumber(e.target.value ? Number(e.target.value) : null)}
                  placeholder="可空白"
                  className="mt-1 h-8 w-full rounded border border-rule-2 px-2 text-[13px]"
                />
              </label>
            </div>
            <div className="mt-2 text-[11px] leading-5 text-ink-3">
              在任何頁面框選答案或詳解，都會直接寫入 Supabase，並掛回目前題號。
            </div>
          </Panel>

          <Panel title="Q 狀態">
            <div className="grid grid-cols-3 gap-2">
              <StatusTile label="題幹" value={targetStatus.question} good={targetStatus.question > 0} />
              <StatusTile label="答案" value={targetStatus.answer} good={targetStatus.answer > 0} />
              <StatusTile label="詳解" value={targetStatus.solution} good={targetStatus.solution > 0} />
              <StatusTile label="選項" value={targetStatus.option} good={targetStatus.option > 0} />
              <StatusTile label="圖片" value={targetStatus.figure} good={targetStatus.figure > 0} />
              <StatusTile label="難度" value={targetStatus.difficulty ? DIFFICULTY_LABEL[targetStatus.difficulty] : "未設"} good={!!targetStatus.difficulty} />
            </div>
            {targetQuestion && (
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-semibold text-ink-3">題幹預覽</div>
                <QuestionPreview q={targetQuestion} />
              </div>
            )}
          </Panel>

          {selected && (
            <PairingSelectedPanel
              box={selected}
              onPatch={patchBox}
              onDelete={() => deleteBox(selected.id)}
            />
          )}

          <Panel title="本題已配對框">
            <div className="max-h-[260px] space-y-1 overflow-auto">
              {targetBoxes.length === 0 && (
                <div className="text-[12px] text-ink-3">尚無資料。</div>
              )}
              {targetBoxes.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    if (b.page_id !== page.id) setPairingPage(b.page_id);
                    setSelected(b);
                  }}
                  className="w-full rounded border border-rule-2 bg-white px-2 py-1.5 text-left text-[12px] hover:bg-rule/40"
                >
                  <span className="font-semibold" style={{ color: BOX_TYPE_INFO[b.type].color }}>
                    {BOX_TYPE_INFO[b.type].label}
                  </span>
                  <span className="ml-2 text-ink-3">p.{b.page?.page_number ?? "?"}</span>
                  {b.sub_number != null && <span className="ml-2 text-ink-3">子題 {b.sub_number}</span>}
                </button>
              ))}
            </div>
          </Panel>

          <div className="rounded-md border border-rule-2 bg-[#fffdf8] p-3 text-[11px] leading-5 text-ink-3">
            多人協作時，本頁會監聽同一本書的標註變更；其他老師新增或修改框後會自動重新整理。
          </div>
        </aside>
      </div>

      {busy && (
        <div className="fixed bottom-4 right-4 rounded bg-ink px-3 py-2 text-[12px] text-paper shadow">
          儲存中...
        </div>
      )}
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-rule-2 bg-[#fffdf8] p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{title}</div>
      {children}
    </div>
  );
}

function StatusTile({ label, value, good }: { label: string; value: React.ReactNode; good: boolean }) {
  return (
    <div className="rounded border border-rule bg-paper p-2">
      <div className="text-[10px] text-ink-3">{label}</div>
      <div className={"mt-1 text-[16px] font-semibold " + (good ? "text-good" : "text-danger")}>
        {value}
      </div>
    </div>
  );
}

function QuestionPreview({ q }: { q: QuestionBox }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!q.page?.png_path) return;
    let cancelled = false;
    let objUrl: string | null = null;
    (async () => {
      const { data } = await supabase().storage.from(BUCKET).download(q.page!.png_path!);
      if (cancelled || !data) return;
      objUrl = URL.createObjectURL(data);
      setSrc(objUrl);
    })();
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [q.page?.png_path]);

  if (!q.page?.width || !q.page?.height) return null;

  const dispW = 280;
  const dispH = Math.min(180, Math.max(70, Math.round(dispW * (q.bbox.h / q.bbox.w))));
  const scaleFactor = dispW / q.bbox.w;

  return (
    <div
      className="relative overflow-hidden rounded border border-rule-2 bg-white"
      style={{ width: "100%", height: dispH }}
    >
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-3">
          載入預覽...
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
            width: q.page.width * scaleFactor,
            height: q.page.height * scaleFactor,
            maxWidth: "none",
          }}
        />
      )}
    </div>
  );
}

function PairingSelectedPanel({
  box,
  onPatch,
  onDelete,
}: {
  box: BookBox;
  onPatch: (id: string, patch: Partial<Box>) => void;
  onDelete: () => void;
}) {
  return (
    <Panel title="已選框">
      <div className="mb-2 rounded border border-rule bg-paper p-2 text-[12px]">
        <span className="font-semibold" style={{ color: BOX_TYPE_INFO[box.type].color }}>
          {BOX_TYPE_INFO[box.type].label}
        </span>
        <span className="ml-2 text-ink-3">p.{box.page?.page_number ?? "?"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-ink-3">
          題號
          <input
            type="number"
            value={box.question_number ?? ""}
            onChange={(e) => onPatch(box.id, { question_number: e.target.value ? Number(e.target.value) : null })}
            className="mt-1 h-8 w-full rounded border border-rule-2 px-2 text-[13px]"
          />
        </label>
        <label className="text-[11px] text-ink-3">
          子題
          <input
            type="number"
            value={box.sub_number ?? ""}
            onChange={(e) => onPatch(box.id, { sub_number: e.target.value ? Number(e.target.value) : null })}
            className="mt-1 h-8 w-full rounded border border-rule-2 px-2 text-[13px]"
          />
        </label>
      </div>
      {box.type === "question" && (
        <div className="mt-3 rounded-md border-2 border-warn bg-warn/10 p-3">
          <div className="text-[11px] font-semibold text-warn">
            題幹 Q{box.question_number ?? "?"}：請標註難易度
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => onPatch(box.id, { difficulty: d })}
                className={
                  "h-9 rounded border text-[12px] font-semibold transition-colors " +
                  (box.difficulty === d
                    ? "border-ink bg-ink text-paper"
                    : "border-rule-2 bg-paper text-ink-2 hover:bg-rule/40")
                }
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[10px] leading-5 text-ink-3">
            整題難易度設在題幹；選項／答案／詳解不需另外標。
          </div>
        </div>
      )}
      <button
        onClick={onDelete}
        className="mt-3 h-8 w-full rounded border border-danger text-[12px] text-danger"
      >
        刪除這個框
      </button>
    </Panel>
  );
}
