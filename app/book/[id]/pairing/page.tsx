"use client";

import dynamic from "next/dynamic";

const CrossPagePairingView = dynamic(
  () => import("@/components/CrossPagePairingView").then((m) => m.CrossPagePairingView),
  { ssr: false, loading: () => <div className="p-10 text-ink-3">載入跨頁配對工作台...</div> },
);

export default function PairingRoute() {
  return <CrossPagePairingView />;
}
