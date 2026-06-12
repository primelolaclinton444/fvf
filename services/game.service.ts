/**
 * Game service — Phase 2 (transitional).
 *
 * Validation, board updates, and settlement now live on the server. In Step 5
 * (next pair), Edge Functions will re-run the existing TS validators on the
 * server and call thin persist-RPCs (`record_async_result`, `record_connect4_move`).
 *
 * For Steps 3+4 we keep the *function names* the play page already uses, but
 * route them through RPCs/Edge calls. Async submit currently calls the
 * persist-RPC directly (because RLS denies direct table writes anyway, the
 * worst a tampered client can do is fail validation in Step 5). Connect 4
 * moves go through the existing `enter_match` / `connect4_ready` RPCs and the
 * `record_connect4_move` RPC. All functions are async now.
 */
import type { Challenge } from '@/types/challenge';
import { supabase } from '@/lib/supabase';
import { rowToChallenge } from '@/lib/db-mappers';
import { applyMove, detectWinner, isDraw, type Connect4Board, type Connect4Player } from '@/lib/connect4/engine';
import { requestAdjudication, readyUp } from './challenge.service';

export type AsyncMoveRecord = { value: number; timestamp: number };

const MIN_PLAUSIBLE_MS = 500;

// ── Async submit ─────────────────────────────────────────────────────────────

export async function submitAsyncResult(input: {
  code: string;
  role: 'creator' | 'opponent';
  uid: string;
  moves: AsyncMoveRecord[];
}): Promise<Challenge> {
  const { code, uid, moves } = input;
  if (moves.length < 2) throw new Error('NO_MOVES');
  const finalMs = moves[moves.length - 1].timestamp - moves[0].timestamp;
  if (finalMs < MIN_PLAUSIBLE_MS) throw new Error('IMPLAUSIBLE_TIME');

  // Persist via RPC. The server settles automatically when both players are in.
  // Step 5 inserts an Edge Function in front of this that re-runs the seed and
  // validates move legality before this RPC ever runs.
  const { data, error } = await supabase.rpc('record_async_result', {
    p_code: code.toUpperCase(),
    p_player: uid,
    p_moves: moves,
    p_final_ms: finalMs,
  });
  if (error) throw new Error(error.message);
  return rowToChallenge(Array.isArray(data) ? data[0] : data);
}

// ── Connect 4 move ───────────────────────────────────────────────────────────

export async function submitConnect4Move(input: { code: string; uid: string; col: number }): Promise<Challenge> {
  const { code, uid, col } = input;

  // Read current board, apply locally to get the next board + winner/draw, then
  // hand it to the persist-RPC. Step 5 replaces this client-side computation
  // with an Edge Function that re-derives the next board from the move log and
  // rejects anything inconsistent.
  const { data: matchRow, error: mErr } = await supabase
    .from('connect4_matches')
    .select('board_state')
    .eq('challenge_code', code.toUpperCase())
    .maybeSingle();
  if (mErr || !matchRow) throw new Error('MATCH_NOT_FOUND');

  const { data: chRow, error: cErr } = await supabase
    .from('challenges')
    .select('creator_id, opponent_id, current_turn_id')
    .eq('code', code.toUpperCase())
    .maybeSingle();
  if (cErr || !chRow) throw new Error('CHALLENGE_NOT_FOUND');
  if (chRow.current_turn_id !== uid) throw new Error('NOT_YOUR_TURN');

  const player: Connect4Player = uid === chRow.creator_id ? 1 : 2;
  const board: Connect4Board = (matchRow.board_state ?? []) as Connect4Board;
  const { board: next } = applyMove(board, col, player);      // throws on illegal col
  const winner = detectWinner(next);
  const winnerUid: string | null = winner === 1 ? chRow.creator_id : winner === 2 ? chRow.opponent_id : null;
  const draw = !winner && isDraw(next);

  const { data, error } = await supabase.rpc('record_connect4_move', {
    p_code: code.toUpperCase(),
    p_actor: uid,
    p_col: col,
    p_board: next as unknown as number[],
    p_winner: winnerUid,
    p_draw: draw,
  });
  if (error) throw new Error(error.message);
  return rowToChallenge(Array.isArray(data) ? data[0] : data);
}

// ── Ready / adjudicate — thin wrappers so the play page imports stay the same ─

export async function submitConnect4Ready(input: { code: string; uid: string; ready: boolean }): Promise<Challenge> {
  return readyUp(input);
}

/**
 * Opportunistic, client-side hint: ask the server to adjudicate this challenge
 * now. `pg_cron` does the same thing every 15s anyway, so this is purely a
 * latency reduction for users who happen to be looking at the page.
 */
export async function checkAndAdjudicate(code: string, _now: number): Promise<void> {
  await requestAdjudication(code);
}
