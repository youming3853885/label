"use client";

import dynamic from "next/dynamic";

// react-konva isn't SSR-safe — load the editor client-side only.
const AnnotatorView = dynamic(
  () => import("@/components/AnnotatorView").then((m) => m.AnnotatorView),
  { ssr: false, loading: () => <div className="p-10 text-ink-3">載入中…</div> },
);

export default function PageRoute() {
  return <AnnotatorView />;
}
