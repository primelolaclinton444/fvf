/**
 * Realtime — Phase 2.
 *
 * Source of truth is now Postgres. Writes self-broadcast over Supabase Realtime
 * (logical replication → `postgres_changes`), so `publish` becomes a no-op and
 * `subscribe` opens a channel for the topic/code we care about.
 *
 * Call-site contract is unchanged from Phase 1 — `subscribe('challenge', handler)`
 * still works, handler still receives a code or '*'.
 *
 * REQUIRED ONCE in the database (Step 4 SQL):
 *   alter publication supabase_realtime add table challenges, connect4_matches, async_results;
 */
import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type RealtimeTopic = 'challenge' | 'match';

type Handler = (code: string) => void;

/** Phase-1 stores called this after every write. Realtime makes it redundant. */
export function publish(_topic: RealtimeTopic, _code: string): void {
  /* no-op in Phase 2: Postgres self-broadcasts */
}

/**
 * Subscribe to all changes for a topic. The handler receives '*' because we
 * don't know which code changed without filtering server-side; consumers either
 * re-fetch the list (Arcade) or check that '*' matches their code (Play).
 */
export function subscribe(topic: RealtimeTopic, handler: Handler): () => void {
  if (typeof window === 'undefined') return () => {};

  const table = topic === 'challenge' ? 'challenges' : 'connect4_matches';
  const channel: RealtimeChannel = supabase
    .channel(`p4s:${topic}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => handler('*'))
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

/** Subscribe to one specific challenge code — used by the Play page. */
export function subscribeToChallenge(code: string, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`p4s:challenge:${code}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'challenges', filter: `code=eq.${code}` },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'connect4_matches', filter: `challenge_code=eq.${code}` },
      () => onChange(),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

/** Coarse-signal helper kept for backwards compatibility with Phase-1 callers. */
export function matchesCode(signal: string, _code: string): boolean {
  return signal === '*' || true;
}
