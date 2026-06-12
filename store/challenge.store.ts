/**
 * Phase 2: challenges live in Postgres. This file is kept only so any stray
 * Phase-1 imports still type-check. Reads return empty / undefined; writes are
 * no-ops. Real reads go through `services/challenge.service.ts` (DB).
 */
import type { Challenge } from '@/types/challenge';

export function loadChallenges(): Record<string, Challenge> { return {}; }
export function saveChallenges(_map: Record<string, Challenge>): void { /* no-op */ }
export function readChallenge(_code: string): Challenge | undefined { return undefined; }
export function writeChallenge(_ch: Challenge): void { /* no-op */ }
export function readAllChallenges(): Challenge[] { return []; }
