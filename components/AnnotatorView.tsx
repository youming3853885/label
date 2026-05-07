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
  const nextQuestionNumber = useMemo(() => {
    const max = boxes
      .filter((b) => b.type === "question" && b.question_number != null)
      .reduce((m, b) => Math.max(m, b.question_number ?? 0), 0);
    return max + 1;
  }, [boxes]);

  // Save a new box. Uses the current activeType + pendingNumber.
  const saveBox = useCallback(
    async (bbox: { x: number; y: number; w: number; h: number }) => {
      if (!page || !book || !annotatorName) return;
      const sb = supabase();
      const { data: userData } = await sb.auth.getUser();
      const created_by = userData.user?.id ?? null;

      const qnum =
        pendingNumber ??
        (activeType === "question" ? nextQuestionNumber : null);

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
    },
    [page, book, annotatorName, activeType, pendingNumber, nextQuestionNumber],
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, patchBox, deleteBox, verifyPage, annotatorName]);

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
          <div className="flex-1 serif text-[14px] truncate">
            {book.title} · p.{page.page_number}/{book.total_pages}
          </div>
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
            <div className="text-[11px] text-ink-3">
              先輸入要對應的題號 → 再劃框 → 答案/詳解會跟早頁的題目綁起來
              <input
                type="number"
                placeholder="題號"
                value={pendingNumber ?? ""}
                onChange={(e) => setPendingNumber(e.target.value ? Number(e.target.value) : null)}
                className="mt-2 w-full h-8 px-2 rounded border border-rule-2 text-[13px]"
              />
            </div>
          )}
          {pass === "question" && (
            <div className="text-[11px] text-ink-3">
              下個題目自動編號 <span className="text-ink font-semibold">Q{nextQuestionNumber}</span>
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
            <div>Enter — 此頁確認完</div>
            <div>Delete — 刪除選中框</div>
            <div>Esc — 取消選擇</div>
          </div>
        </div>
      </div>
    </main>
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
