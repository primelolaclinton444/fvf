// supabase/functions/match-start/index.ts
//
// Issues the playable board to the requesting player AND records the server
// timestamp at which the board was issued (idempotent — first call wins).
// The recorded timestamp is what we cross-check `final_ms` against on submit,
// so the client cannot inflate or fabricate its own elapsed time.
//
// Returns: { startedAt: ISO, grid: number[25], targets?: number[5] }
//   - SCOUT: targets is the 5 numbers to find
//   - DOWN/UP: no targets (sequence is fixed 25→1 or 1→25)
//   - CONNECT4: this endpoint is unused — Connect4 board lives in the DB row
//
// Trust model: caller's JWT identifies the player; we re-derive grid/targets
// from the DB seed; the server timestamp is set by Postgres. Client never
// supplies any of these.

import { prngFromSeed, seededPickUnique, gameGridFromSeed } from "../_shared/prng.ts";
import { corsHeaders, jsonResponse, clientAs, serviceClient } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });

  let body: { code?: string };
  try { body = await req.json(); } catch { return jsonResponse(400, { error: "BAD_JSON" }); }
  const code = (body.code ?? "").toUpperCase();
  if (!code) return jsonResponse(400, { error: "MISSING_CODE" });

  // Identify caller via their JWT (RLS does the participant check on the read).
  const userClient = clientAs(req);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse(401, { error: "NOT_AUTHENTICATED" });

  // Service-role read so we can see `seed` regardless of any future RLS tightening.
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

  // First call stamps server time; later calls return the same one.
  const { data: startedAt, error: startErr } = await svc.rpc("issue_match_start", {
    p_code: code,
    p_player: user.id,
  });
  if (startErr) return jsonResponse(500, { error: startErr.message });

  // Derive board from the (rotated-at-MATCH_ACTIVE) seed — same code as the client.
  const grid = gameGridFromSeed(ch.seed);
  let targets: number[] | undefined;
  if (ch.game_type === "SCOUT") {
    const rnd = prngFromSeed("targets-" + ch.seed);
    targets = seededPickUnique(Array.from({ length: 25 }, (_, i) => i + 1), 5, rnd);
  }

  return jsonResponse(200, { startedAt, grid, targets, gameType: ch.game_type });
});
