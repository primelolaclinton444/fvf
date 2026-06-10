import type { ChallengePhase } from './challenge';

export type Connect4Move = {
  moveIndex: number;
  actorUid: string;
  col: number;
  timestamp: number;
};

export type Connect4MatchState = {
  challengeCode: string;
  challengeId: string;
  boardState: number[];
  moves: Connect4Move[];
  phase: ChallengePhase;
  startedAt?: number;
  endedAt?: number;
};
