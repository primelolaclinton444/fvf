/**
 * Phase 2: Connect4 board lives in Postgres (`connect4_matches`). The
 * Phase-1 sync read/write API is kept as no-op shims so legacy imports
 * still compile; the play page uses `readMatchAsync` below.
 */
import type { Connect4MatchState } from '@/types/connect4';
import { supabase } from '@/lib/supabase';

export function loadMatches(): Record<string, Connect4MatchState> { return {}; }
export function saveMatches(_map: Record<string, Connect4MatchState>): void { /* no-op */ }
export function readMatch(_code: string): Connect4MatchState | undefined { return undefined; }
export function writeMatch(_match: Connect4MatchState): void { /* no-op */ }

/** Async DB read — used by the Connect 4 play UI in Phase 2. */
export async function readMatchAsync(code: string): Promise<Connect4MatchState | undefined> {
  if (!code) return undefined;
  const { data, error } = await supabase
    .from('connect4_matches')
    .select('*')
    .eq('challenge_code', code.toUpperCase())
    .maybeSingle();
  if (error || !data) return undefined;

  return {
    challengeCode: data.challenge_code,
    challengeId: data.challenge_code,
    boardState: (data.board_state ?? []) as number[],
    moves: [],          // populated separately if/when the move log UI needs it
    phase: data.phase as Connect4MatchState['phase'],
  };
}
