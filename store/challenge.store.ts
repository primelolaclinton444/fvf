import type { Challenge } from '@/types/challenge';
import { publish } from '@/lib/realtime';

const LS_CHALLENGES = 'p4s_challenges_v3';

export function loadChallenges(): Record<string, Challenge> {
  try {
    const s = localStorage.getItem(LS_CHALLENGES);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

export function saveChallenges(map: Record<string, Challenge>): void {
  localStorage.setItem(LS_CHALLENGES, JSON.stringify(map));
}

export function readChallenge(code: string): Challenge | undefined {
  return loadChallenges()[code.toUpperCase()];
}

export function writeChallenge(ch: Challenge): void {
  const map = loadChallenges();
  map[ch.code] = ch;
  saveChallenges(map);
  // Propagate to other tabs so the counterparty reacts without waiting for the poll.
  publish('challenge', ch.code);
}

export function readAllChallenges(): Challenge[] {
  return Object.values(loadChallenges());
}
