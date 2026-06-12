'use client';
import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client. Session is persisted in localStorage and auto-refreshed.
 * The whole app is client-rendered, so the plain js client is all we need — no
 * SSR cookie wiring. Service-role key is NEVER used here (Edge Functions only).
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
