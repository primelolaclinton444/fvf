// supabase/functions/connect4-move/index.ts
//
// Server replays the move log + new column through the engine, derives the
// next board itself, detects winner/draw, and only THEN calls the persist-RPC
// with the server-derived board. The client never supplies a board, just a
// column. This closes Phase 1's last client-trust hole for Connect4.

import {
  CONNECT4_COLS,
  applyMove,
  createEmptyBoard,
  detectWinner,
  isDraw,
  type Connect4Board,
  type Connect4Player,
} from "../_shared/engine.ts";
import { corsHeaders, jsonResponse, clientAs, serviceClient } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });

  let body: { code?: string; col?: number };
  try { body = await req.json(); } catch { return jsonResponse(400, { error: "BAD_JSON" }); }
  const code = (body.code ?? "").toUpperCase();
  const col  = body.col;
  if (!code) return jsonResponse(400, { error: "MISSING_CODE" });
  if (typeof col !== "number" || !Number.isInteger(col) || col < 0 || col >= CONNECT4_COLS)
    return jsonResponse(400, { error: "OUT_OF_RANGE" });

  const userClient = clientAs(req);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse(401, { error: "NOT_AUTHENTICATED" });

  const svc = serviceClient();

  // Pull challenge metadata so we can check phase + whose turn it is.
  const { data: ch, error: chErr } = await svc
    .from("challenges")
    .select("code, status, phase, creator_id, opponent_id, current_turn_id, turn_deadline_at")
    .eq("code", code)
    .maybeSingle();
  if (chErr || !ch)                          return jsonResponse(404, { error: "CHALLENGE_NOT_FOUND" });
  if (ch.status !== "MATCH_ACTIVE")          return jsonResponse(409, { error: "MATCH_NOT_ACTIVE" });
  if (ch.phase !== "IN_PROGRESS")            return jsonResponse(409, { error: "INVALID_PHASE" });
  if (![ch.creator_id, ch.opponent_id].includes(user.id))
                                              return jsonResponse(403, { error: "NOT_A_PARTICIPANT" });
  if (ch.current_turn_id !== user.id)        return jsonResponse(409, { error: "NOT_YOUR_TURN" });
  if (ch.turn_deadline_at && new Date(ch.turn_deadline_at).getTime() < Date.now())
                                              return jsonResponse(409, { error: "DEADLINE_EXPIRED" });

  // Replay the WHOLE move log to derive the canonical board. We do NOT read
  // `connect4_matches.board_state` and trust it — the move log is the truth.
  const { data: moves, error: mvErr } = await svc
    .from("connect4_moves")
    .select("move_index, actor_id, col")
    .eq("challenge_code", code)
    .order("move_index", { ascending: true });
  if (mvErr) return jsonResponse(500, { error: mvErr.message });

  let board: Connect4Board = createEmptyBoard();
  let expectedActor = ch.creator_id as string;
  try {
    for (const m of moves ?? []) {
      const player: Connect4Player = m.actor_id === ch.creator_id ? 1 : 2;
      if (m.actor_id !== expectedActor) throw new Error("CORRUPT_MOVE_LOG");
      ({ board } = applyMove(board, m.col, player));
      expectedActor = expectedActor === ch.creator_id ? ch.opponent_id : ch.creator_id;
    }
    // Apply the new move from the caller (whose turn we already verified).
    const player: Connect4Player = user.id === ch.creator_id ? 1 : 2;
    if (user.id !== expectedActor) throw new Error("NOT_YOUR_TURN");
    ({ board } = applyMove(board, col, player));
  } catch (e) {
    return jsonResponse(422, { error: e instanceof Error ? e.message : "INVALID_MOVE" });
  }

  const winner = detectWinner(board);
  const draw   = !winner && isDraw(board);
  const winnerUid =
    winner === 1 ? ch.creator_id : winner === 2 ? ch.opponent_id : null;

  const { data, error: rErr } = await svc.rpc("record_connect4_move", {
    p_code: code,
    p_actor: user.id,
    p_col: col,
    p_board: board,
    p_winner: winnerUid,
    p_draw: draw,
  });
  if (rErr) return jsonResponse(400, { error: rErr.message });

  return jsonResponse(200, { ok: true, challenge: data });
});
