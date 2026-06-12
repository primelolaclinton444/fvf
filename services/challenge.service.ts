/**
 * Challenge service — Phase 2.
 *
 * Mutations call RPCs (`create_challenge`, `accept_challenge`, `enter_match`,
 * `connect4_ready`, `adjudicate`). The RPCs are SECURITY DEFINER + row-locked,
 * so the client never directly writes to `wallets`, `challenges`, or any of
 * their friends. The double-credit race from Phase 1 is gone by construction.
 *
 * All functions are async now — old call sites need `await`.
 */
import type { Challenge, GameType, MatchFormat } from '@/types/challenge';
import { supabase } from '@/lib/supabase';
import { rowToChallenge, rowsToChallenges } from '@/lib/db-mappers';
import { decodeChallengeInvite } from '@/lib/invite';

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getChallenge(code: string): Promise<Challenge | undefined> {
  if (!code) return undefined;
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle();
  if (error || !data) return undefined;
  return rowToChallenge(data);
}

export async function listChallenges(uid: string): Promise<Challenge[]> {
  if (!uid) return [];
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .or(`creator_id.eq.${uid},opponent_id.eq.${uid}`)
    .order('created_at', { ascending: false });
  if (error) return [];
  return rowsToChallenges(data);
}

// ── Mutations (all go through RPCs) ──────────────────────────────────────────

export async function createChallenge(input: {
  uid: string;
  gameType: GameType;
  stake: number;
  matchFormat?: MatchFormat;
  targetOpponentUid?: string;
}): Promise<Challenge> {
  const { gameType, stake, matchFormat = 'SINGLE', targetOpponentUid } = input;
  const { data, error } = await supabase.rpc('create_challenge', {
    p_game: gameType,
    p_stake: stake,
    p_format: matchFormat,
    p_target: targetOpponentUid ?? null,
  });
  if (error) throw new Error(error.message);
  // RPC returns a single row from a table function; Supabase gives it as an object.
  return rowToChallenge(Array.isArray(data) ? data[0] : data);
}

export async function acceptChallenge(input: { code: string; uid: string }): Promise<Challenge> {
  const { data, error } = await supabase.rpc('accept_challenge', { p_code: input.code.toUpperCase() });
  if (error) throw new Error(error.message);
  return rowToChallenge(Array.isArray(data) ? data[0] : data);
}

export async function joinMatch(input: { code: string; uid: string }): Promise<Challenge> {
  const { data, error } = await supabase.rpc('enter_match', { p_code: input.code.toUpperCase() });
  if (error) throw new Error(error.message);
  return rowToChallenge(Array.isArray(data) ? data[0] : data);
}

export async function readyUp(input: { code: string; uid: string; ready: boolean }): Promise<Challenge> {
  const { data, error } = await supabase.rpc('connect4_ready', {
    p_code: input.code.toUpperCase(),
    p_ready: input.ready,
  });
  if (error) throw new Error(error.message);
  return rowToChallenge(Array.isArray(data) ? data[0] : data);
}

/** Fire-and-forget; safe to call repeatedly. The RPC is idempotent under a row lock. */
export async function requestAdjudication(code: string): Promise<void> {
  await supabase.rpc('adjudicate', { p_code: code.toUpperCase() });
}

// ── Invite hydration ─────────────────────────────────────────────────────────
// In Phase 2 the canonical challenge lives in the DB — we don't recreate it on
// the opponent's device. This function survives as a noop for backward compat
// with old join links that carry an `?invite=` payload; the join page will just
// fetch the challenge by code.
export function hydrateChallengeFromInvite(_invite: string): Challenge | undefined {
  try { decodeChallengeInvite(_invite); } catch { /* ignore */ }
  return undefined;
}
