import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "標籤工具 — 名師講義 PDF 標註",
  description: "為 AI 教育平台標註名師講義頁面",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        {/* Noto Serif TC + Inter from Google Fonts CDN — keeps the standalone
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
