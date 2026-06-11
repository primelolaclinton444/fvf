import type { Connect4MatchState } from '@/types/connect4';
import { publish } from '@/lib/realtime';

const LS_MATCHES = 'p4s_connect4_match_states_v1';

export function loadMatches(): Record<string, Connect4MatchState> {
  try {
    const s = localStorage.getItem(LS_MATCHES);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

export function saveMatches(map: Record<string, Connect4MatchState>): void {
  localStorage.setItem(LS_MATCHES, JSON.stringify(map));
}

export function readMatch(code: string): Connect4MatchState | undefined {
  return loadMatches()[code.toUpperCase()];
}

export function writeMatch(match: Connect4MatchState): void {
  const map = loadMatches();
  map[match.challengeCode] = match;
  saveMatches(map);
  // Propagate board/phase changes to the opponent's tab in real time.
  publish('match', match.challengeCode);
}
