"use client";

// Annotator typed display name. Saved in localStorage so we don't ask every
// page. UI exposes a "switch user" button to clear it. Distinct from the
// Supabase auth user id (which is sent automatically with each query).

const KEY = "label.annotator_name";

export function getAnnotatorName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setAnnotatorName(name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim();
  if (!trimmed) return;
  localStorage.setItem(KEY, trimmed);
}

export function clearAnnotatorName(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
