/**
 * Shared utilities for Edge Functions: CORS headers and Supabase clients.
 *
 * Two clients are exposed:
 *   • clientAs(req)  — anon-key client carrying the caller's JWT. Use this to
 *     `auth.getUser()` and to perform any read the caller is themselves entitled
 *     to via RLS.
 *   • serviceClient — service-role client. Bypasses RLS. Use ONLY for the
 *     trusted persist-RPCs after validation has passed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function clientAs(req: Request) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  return createClient(url, anon, { global: { headers: { Authorization: auth } } });
}

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}
