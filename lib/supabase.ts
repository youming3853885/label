"use client";

import { createBrowserClient } from "@supabase/ssr";

// Singleton browser client. Annotators read books / pages / write boxes
// directly through here — RLS policies enforce role gating.
let _client: ReturnType<typeof createBrowserClient> | null = null;
export function supabase() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local and fill the values.",
    );
  }
  _client = createBrowserClient(url, key);
  return _client;
}

// Public PNG URL helper. Bucket policy must allow authenticated reads.
export function pageImageUrl(pngPath: string): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${url}/storage/v1/object/authenticated/annotation-source/${pngPath}`;
}
