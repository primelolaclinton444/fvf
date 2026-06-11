export type GameType = 'SCOUT' | 'DOWN' | 'UP' | 'CONNECT4';

export type ChallengeMode = 'ASYNC' | 'SYNC';
export type ChallengePhase = 'WAITING_READY' | 'IN_PROGRESS' | 'COMPLETE';
export type ChallengeResultType = 'WIN' | 'DRAW' | 'FORFEIT';
export type MatchFormat = 'SINGLE' | 'BEST_OF_3';

/**
 * Full lifecycle states. Aligned with Skill Escrow contract states.
 */
export type ChallengeStatus =
  | 'AWAITING_OPPONENT'    // creator funded, link valid, waiting for opponent
  | 'FULLY_FUNDED'         // both stakes locked
  | 'JOIN_WINDOW_STARTED'  // join timer running (3 min)
  | 'MATCH_ACTIVE'         // both joined, game live
  | 'RESULT_VERIFIED'      // game.service confirmed winner
  | 'SETTLED'              // payout complete
  | 'EXPIRED'              // opponent never accepted
  | 'CREATOR_REFUNDED'     // post-expiry refund done
  | 'ONE_PLAYER_ABSENT'    // join window passed, one missing
  | 'FORFEIT'              // forfeit determined
  | 'PRESENT_PLAYER_PAID'  // forfeit payout complete
  | 'BOTH_REFUNDED';       // join window expired, both stakes returned

export type FeeStructure = {
  developerFeePct: number;   // e.g. 5
  protocolFeePct: number;    // e.g. 5
  // winner gets 100 - developerFeePct - protocolFeePct
};

export type Result = {
  rawMs: number;
  finalMs: number;
  finishedAt: number;
};

export type SettlementSnapshot = {
  pot: number;
  winnerAmount: number;
  developerAmount: number;
  protocolAmount: number;
  winnerUid: string | null;
  reason: ChallengeResultType | 'TIE' | 'REFUND' | 'NO_SHOW_REFUND';
  finalizedAt: number;
};

export type Challenge = {
  code: string;
  gameType: GameType;
  seed: string;
  stake: number;
  status: ChallengeStatus;
  matchFormat: MatchFormat;
  feeStructure: FeeStructure;

  creatorUid?: string;
  opponentUid?: string;
  targetOpponentUid?: string;     // if set, only this uid can accept

  creatorAccepted?: boolean;
  opponentAccepted?: boolean;
  escrowedCreator?: number;
  escrowedOpponent?: number;

  creatorResult?: Result;
  opponentResult?: Result;

  createdAt: number;
  expiresAt: number;
  joinWindowStartedAt?: number;
  joinDeadlineAt?: number;
  matchDeadlineAt?: number;       // async: deadline for both runs to be submitted
  creatorJoined?: boolean;
  opponentJoined?: boolean;

  // Connect 4 specific
  mode?: ChallengeMode;
  phase?: ChallengePhase;
  readyCreator?: boolean;
  readyOpponent?: boolean;
  readyDeadlineAt?: number;
  turnDeadlineAt?: number;
  turnNumber?: number;
  currentTurnUid?: string;

  // Outcome
  winnerUid?: string;
  resultType?: ChallengeResultType;
  forfeitUid?: string;

  // Settlement
  settled?: boolean;
  settlementTxId?: string;
  settlementSnapshot?: SettlementSnapshot;
};

export type ChallengeInvite = Pick<
  Challenge,
  | 'code' | 'gameType' | 'seed' | 'stake'
  | 'createdAt' | 'expiresAt' | 'creatorUid'
  | 'escrowedCreator' | 'mode' | 'phase'
  | 'readyCreator' | 'readyOpponent' | 'turnNumber'
  | 'matchFormat' | 'feeStructure' | 'targetOpponentUid'
>;
