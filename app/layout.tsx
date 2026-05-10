import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "label · 課綱審核與講義標註",
  description: "知識圖譜說明、T0 課綱審查、UPAD12 教師審核與講義標註入口。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        {/* Noto Serif TC + Inter from Google Fonts CDN keeps the standalone
            repo zero-config and avoids a font-loader dependency. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Serif+TC:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
