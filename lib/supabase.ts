"use client";

import { createBrowserClient } from "@supabase/ssr";

// Hardcoded Supabase config. The anon key is designed to be public —
// security comes from RLS policies, not from secrecy of this string.
// Inlining here side-steps Vercel env-var Sensitive-flag confusion.
const SUPABASE_URL = "https://iwbwhwivmcjnmmalcssd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3Yndod2l2bWNqbm1tYWxjc3NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTA3NTEsImV4cCI6MjA5MjYyNjc1MX0.IZFJsl_cA6pCNSmudaBHBYhBkyHGo_j0gI4D-UK5yIg";

// Singleton browser client. Annotators read books / pages / write boxes
// directly through here — RLS policies enforce role gating.
let _client: ReturnType<typeof createBrowserClient> | null = null;
export function supabase() {
  if (_client) return _client;
  _client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

// Public PNG URL helper. Bucket policy must allow authenticated reads.
export function pageImageUrl(pngPath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/authenticated/annotation-source/${pngPath}`;
}
