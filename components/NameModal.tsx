"use client";

import { useEffect, useState } from "react";
import { getAnnotatorName, setAnnotatorName } from "@/lib/name";

/** First-load modal asking the teacher to type their display name.
 *  Stored in localStorage. Every box write attaches it as `annotator_name`. */
export function NameModal({ onReady }: { onReady: (name: string) => void }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const existing = getAnnotatorName();
    if (existing) {
      onReady(existing);
    } else {
      setOpen(true);
    }
  }, [onReady]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAnnotatorName(trimmed);
    setOpen(false);
    onReady(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/50 flex items-center justify-center px-6">
      <div className="bg-paper rounded-md p-6 w-full max-w-sm shadow-lg">
        <div className="serif text-[18px] font-semibold mb-1">請輸入您的姓名</div>
        <p className="text-[12.5px] text-ink-3 mb-4">
          這個名字會記錄在你建立的每個標註上，用於審計與貢獻歸屬。可以是真實姓名或暱稱。
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="例：林志傑"
          className="w-full h-10 px-3 rounded-md border border-rule-2 text-[14px]"
        />
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="mt-3 w-full h-10 rounded-md bg-ink text-paper text-[13px] disabled:opacity-50"
        >
          確認，開始標註
        </button>
      </div>
    </div>
  );
}
