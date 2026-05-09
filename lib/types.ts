// Mirror of public.* tables touched by the annotation app.

export type SourceTier = "T1" | "T2" | "T3" | "T4";

export interface Book {
  id: string;
  book_code: string;
  title: string;
  level: "國小" | "國中" | "高中";
  subject: string;
  grade: number;
  source_tier: SourceTier;
  publisher: string | null;
  edition: string | null;
  year: number | null;
  total_pages: number;
  pages_verified?: number;
  pages_auto_suggested?: number;
  pages_skipped?: number;
}

export type PageStatus = "pending" | "auto_suggested" | "human_verified" | "skipped";

export interface Page {
  id: string;
  book_id: string;
  page_number: number;
  png_path: string;
  width: number;
  height: number;
  status: PageStatus;
  assigned_to: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  notes: string | null;
}

export type BoxType =
  | "question"
  | "option"
  | "answer"
  | "solution"
  | "figure"
  | "skip"
  | "unit_title";

export type Difficulty = "easy" | "medium" | "hard";

export interface Box {
  id: string;
  page_id: string;
  book_id: string;
  type: BoxType;
  bbox: { x: number; y: number; w: number; h: number };
  question_number: number | null;
  sub_number: number | null;
  option_letter: string | null;
  difficulty: Difficulty | null;
  question_type: string | null;
  annotator_name: string | null;
  created_by: string | null;
  source: "auto_suggested" | "human";
  created_at: string;
}

export const BOX_TYPE_INFO: Record<BoxType, { label: string; key: string; color: string }> = {
  question:    { label: "題幹",   key: "Q", color: "#10B981" },
  option:      { label: "選項",   key: "O", color: "#3B82F6" },
  answer:      { label: "答案",   key: "A", color: "#F97316" },
  solution:    { label: "詳解",   key: "S", color: "#A855F7" },
  figure:      { label: "圖片",   key: "D", color: "#EAB308" },
  skip:        { label: "略過",   key: "X", color: "#6B7280" },
  unit_title:  { label: "單元概念", key: "E", color: "#EC4899" },
};

// DIFFICULTY_KEYS (1/2/3 hotkey) removed 2026-05-09 — accidental keypresses
// risked silently writing difficulty into the wrong box. Difficulty is now
// set only via the explicit button UI in the Selected panel.

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "簡單",
  medium: "中等",
  hard: "困難",
};
