/**
 * Game service — Step 5.
 *
 * No more client-side board derivation or winner detection. Both async
 * submission and Connect 4 moves now hit Edge Functions that re-derive
 * everything server-side and call the persist-RPCs themselves. The client's
 * only inputs are: the challenge code, the column or move sequence, and the
 * timestamps it observed.
 */
import type { Challenge } from '@/types/challenge';
import { supabase } from '@/lib/supabase';
import { rowToChallenge } from '@/lib/db-mappers';
import { requestAdjudication, readyUp } from './challenge.service';

export type AsyncMoveRecord = { value: number; timestamp: number };

export type MatchStartResponse = {
  startedAt: string;          // ISO server timestamp
  grid: number[];             // 25 ints
  targets?: number[];         // SCOUT only
  gameType: 'SCOUT' | 'DOWN' | 'UP';
};

/**
 * Ask the server for the playable board + targets. Idempotent: the server
 * stamps `started_at` on the first call only, so a reload returns the same
 * timestamp and the same board. Call this BEFORE the player starts playing —
 * the timestamp is what the server-elapsed check uses on submit.
 */
export async function fetchMatchStart(code: string): Promise<MatchStartResponse> {
  const { data, error } = await supabase.functions.invoke<MatchStartResponse>('match-start', {
    body: { code: code.toUpperCase() },
  });
  if (error || !data) throw new Error(error?.message ?? 'MATCH_START_FAILED');
  return data;
}

export async function submitAsyncResult(input: {
  code: string;
  role: 'creator' | 'opponent';
  uid: string;
  moves: AsyncMoveRecord[];
}): Promise<Challenge> {
  const { data, error } = await supabase.functions.invoke<{ challenge: any; error?: string }>('submit-async', {
    body: { code: input.code.toUpperCase(), moves: input.moves },
  });
  if (error) throw new Error(error.message);
  if (!data || (data as any).error) throw new Error((data as any)?.error ?? 'SUBMIT_FAILED');
  return rowToChallenge(Array.isArray(data.challenge) ? data.challenge[0] : data.challenge);
}

export async function submitConnect4Move(input: { code: string; uid: string; col: number }): Promise<Challenge> {
  const { data, error } = await supabase.functions.invoke<{ challenge: any; error?: string }>('connect4-move', {
    body: { code: input.code.toUpperCase(), col: input.col },
  });
  if (error) throw new Error(error.message);
  if (!data || (data as any).error) throw new Error((data as any)?.error ?? 'MOVE_FAILED');
  return rowToChallenge(Array.isArray(data.challenge) ? data.challenge[0] : data.challenge);
}

// Ready/adjudicate are unchanged from Step 3+4 — they call RPCs directly.
export async function submitConnect4Ready(input: { code: string; uid: string; ready: boolean }): Promise<Challenge> {
  return readyUp(input);
}

export async function checkAndAdjudicate(code: string, _now: number): Promise<void> {
  await requestAdjudication(code);
}
