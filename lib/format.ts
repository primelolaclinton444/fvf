import type { GameType } from '@/types/challenge';

export function formatSeconds(ms: number): string {
  return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

export function gameTitle(game: GameType): string {
  if (game === 'SCOUT') return '5 Numbers Scout';
  if (game === 'DOWN') return '25 Down';
  if (game === 'UP') return '25 Up';
  return 'Connect 4';
}
