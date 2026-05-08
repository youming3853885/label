# label — 名師講義 PDF 標註工具

讓遠端老師線上劃框 + 打標籤的工具。劃完的框由便宜 LLM 抽出乾淨題庫文字，
作為主系統 (study.ezai.today) 的 Phase 1 出題 / Phase 3 Tutor RAG 來源。

## 為什麼有這個工具

- 純 vision OCR 的失敗模式：把答案/詳解當題幹、把目錄當題目、數學排版讀成垂直字串
- 解法：人類劃框「這是題目／這是答案／這是詳解／這是圖／這是要略過的目錄」
- 框內讓便宜 LLM (Gemini Flash / Haiku 4.5) 做純 OCR — 不需要做版面判斷
- **品質從 80-90% 拉到 95-99%**，每筆都有 provenance 可追

## 技術棧

- Next.js 14 App Router (port 3100)
- Supabase (auth / postgres / storage) — 共用主專案的 Supabase project
- react-konva (annotation canvas)
- Tailwind CSS
- 直接打 supabase-js，**沒有 FastAPI 後端** — RLS 把關

## 本機開發

```bash
npm install
cp .env.example .env.local        # 填入 anon key
npm run dev                       # http://localhost:3100
```

## 部署

Vercel 一鍵：

1. import 此 repo 到 Vercel
2. Environment Variables 填：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy

域名建議：`label.ezai.today` 或 `annotate.ezai.today`

## Schema 依賴 (Supabase)

需要主專案先跑這幾條 migration（已在 AI_god repo 裡）：

- `054_annotation_tool.sql` — books / pages / boxes 三表 + RLS
- `054b_source_tier_taxonomy.sql` — source tier + 課綱 subject 分類
- `054c_annotator_name.sql` — annotator_name 欄位
- `054d_annotator_write_policies.sql` — 標註者寫入 RLS

PNG source 需透過 `data/upload_annotation_pages.py` 上傳到 Storage bucket
`annotation-source`。

## 老師使用流程

1. 收到 invite email → 點連結登入
2. 第一次進入彈窗請打字輸入姓名（之後每個框都會記錄）
3. 從書目挑一本書 → 按「從未標頁開始」
4. 每頁：
   - 滑鼠拖拉劃框
   - 按 Q / O / A / S / F / X / U 切框類型
   - 題目框可按 1/2/3 設難易度
   - Tab 切換「題目 Pass / 答案 Pass」處理跨頁配對
   - Enter 確認此頁，自動進下一頁

## 未實作（D5-D7，後續迭代）

- [ ] AI 預標 (Gemini Flash 跑全 3,835 頁先建議 boxes)
- [ ] LLM 抽取 worker（劃框 → 寫入 exam_questions）
- [ ] Admin 進度 dashboard
- [ ] Export ZIP（每本書打包：原圖 + 框 overlay + manifest + 抽出題庫 JSON）
- [ ] 跨頁配對警告（題目有 Q5 但沒答案 → 紅色提示）

## 鍵盤快捷鍵

| 鍵 | 動作 |
|---|---|
| Q | 切到題幹 |
| O | 切到選項 |
| A | 切到答案 |
| S | 切到詳解 |
| D | 切到圖片 |
| X | 切到略過 |
| U | 切到單元概念 |
| 1 / 2 / 3 | 設選中題目的難易度 |
| Tab | 切換 題目/答案 Pass 模式 |
| Enter | 確認此頁，跳下一頁 |
| Delete | 刪除選中框 |
| Esc | 取消選擇 |
