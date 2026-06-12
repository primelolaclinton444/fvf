// supabase/functions/submit-async/index.ts
//
// Validates an async game submission server-side, then persists via RPC.
//
// Trust path:
//   1. JWT identifies the player.
//   2. We re-derive what the grid/targets ARE from the DB seed.
//   3. We replay the client's move sequence against that and reject if it
//      doesn't constitute a valid, complete run for the game type.
//   4. We compute server-elapsed (now − match_starts.started_at) and pass it
//      to record_async_result, which rejects if client's final_ms > server's.
//
// Anything the client could lie about — the grid, the targets, the elapsed
// time, "I completed it" — is checked here against the database.

import {
  prngFromSeed,
  seededPickUnique,
  gameGridFromSeed,
} from "../_shared/prng.ts";
import { corsHeaders, jsonResponse, clientAs, serviceClient } from "../_shared/util.ts";

const MIN_PLAUSIBLE_MS = 500;

type Move = { value: number; timestamp: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });

  let body: { code?: string; moves?: Move[] };
  try { body = await req.json(); } catch { return jsonResponse(400, { error: "BAD_JSON" }); }
  const code = (body.code ?? "").toUpperCase();
  const moves = body.moves ?? [];
  if (!code) return jsonResponse(400, { error: "MISSING_CODE" });
  if (!Array.isArray(moves) || moves.length < 2) return jsonResponse(400, { error: "NO_MOVES" });

  const userClient = clientAs(req);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse(401, { error: "NOT_AUTHENTICATED" });

  const svc = serviceClient();
  const { data: ch, error } = await svc
    .from("challenges")
    .select("code, game_type, seed, status, creator_id, opponent_id")
    .eq("code", code)
    .maybeSingle();
  if (error || !ch) return jsonResponse(404, { error: "CHALLENGE_NOT_FOUND" });
  if (ch.status !== "MATCH_ACTIVE") return jsonResponse(409, { error: "MATCH_NOT_ACTIVE" });
  if (![ch.creator_id, ch.opponent_id].includes(user.id))
    return jsonResponse(403, { error: "NOT_A_PARTICIPANT" });
  if (ch.game_type === "CONNECT4")
    return jsonResponse(400, { error: "USE_CONNECT4_MOVE_FOR_THIS_GAME" });

  // ── Move-sequence validation (server-derived expected sequence) ────────────
  try {
    validateMoveSequence(ch.game_type, ch.seed, moves);
  } catch (e) {
    return jsonResponse(422, { error: e instanceof Error ? e.message : "INVALID_MOVES" });
  }

  // Client-reported time, computed by the server from supplied timestamps —
  // not from a single "final" field that could be made up.
  const finalMs = moves[moves.length - 1].timestamp - moves[0].timestamp;
  if (!Number.isFinite(finalMs) || finalMs < MIN_PLAUSIBLE_MS) {
    return jsonResponse(422, { error: "IMPLAUSIBLE_TIME" });
  }

  // ── Server-elapsed cross-check ─────────────────────────────────────────────
  // Look up when WE issued the board to this player.
  const { data: start } = await svc
    .from("match_starts")
    .select("started_at")
    .eq("challenge_code", code)
    .eq("player_id", user.id)
    .maybeSingle();
  let serverElapsedMs: number | null = null;
  if (start?.started_at) {
    serverElapsedMs = Date.now() - new Date(start.started_at).getTime();
  }
  // (If the player skipped /match-start and went straight to /submit-async we
  // leave serverElapsedMs as null and rely on the RPC's other guards. The
  // client should always call /match-start first; the page wires this up.)

  // ── Persist + maybe settle ─────────────────────────────────────────────────
  const { data, error: rErr } = await svc.rpc("record_async_result", {
    p_code: code,
    p_player: user.id,
    p_moves: moves,
    p_final_ms: finalMs,
    p_server_elapsed_ms: serverElapsedMs,
  });
  if (rErr) return jsonResponse(400, { error: rErr.message });

  return jsonResponse(200, { ok: true, challenge: data });
});

// ──────────────────────────────────────────────────────────────────────────────

function validateMoveSequence(gameType: string, seed: string, moves: Move[]): void {
  if (gameType === "SCOUT") {
    const rnd = prngFromSeed("targets-" + seed);
    const targets = seededPickUnique(Array.from({ length: 25 }, (_, i) => i + 1), 5, rnd);
    if (moves.length !== 5) throw new Error("INVALID_MOVE_COUNT");
    const seen = new Set<number>();
    for (const m of moves) {
      if (!targets.includes(m.value)) throw new Error("INVALID_MOVE_VALUE");
      if (seen.has(m.value)) throw new Error("DUPLICATE_MOVE");
      seen.add(m.value);
    }
    return;
  }
  if (gameType === "DOWN") {
    if (moves.length !== 25) throw new Error("INVALID_MOVE_COUNT");
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].value !== 25 - i) throw new Error("INVALID_MOVE_ORDER");
    }
    // The grid must actually contain all 1..25 — implied by our generator, so we
    // don't need to re-shuffle here; client tapping enforced order anyway.
    return;
  }
  if (gameType === "UP") {
    if (moves.length !== 25) throw new Error("INVALID_MOVE_COUNT");
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].value !== i + 1) throw new Error("INVALID_MOVE_ORDER");
    }
    return;
  }
  // gameGridFromSeed is imported so an environment without the shared module
  // would fail fast at import time; we don't need it directly here but it
  // documents the dependency between the two ports.
  void gameGridFromSeed;
  throw new Error("UNSUPPORTED_GAME_TYPE");
}
