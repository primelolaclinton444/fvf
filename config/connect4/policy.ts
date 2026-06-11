export type NoShowPolicy =
  | 'REFUND_BOTH'
  | 'CREATOR_WINS_BY_NO_SHOW'
  | 'OPPONENT_WINS_BY_NO_SHOW';

export type ForfeitPolicy = 'NON_FORFEITING_PLAYER_TAKES_POT';

export interface Connect4Policy {
  version: '2026-05-23.v1';
  openExpiresInMs: number;
  readyTimeoutMs: number;
  turnTimeoutMs: number;
  reconnectGraceMs: number;
  noShowPolicy: NoShowPolicy;
  forfeitPolicy: ForfeitPolicy;
}

export const connect4Policy: Connect4Policy = {
  version: '2026-05-23.v1',
  openExpiresInMs: 5 * 60 * 1000,
  readyTimeoutMs: 30 * 1000,
  turnTimeoutMs: 30 * 1000,
  reconnectGraceMs: 10 * 1000,
  /*
    FIX BUG 7: this was already set to REFUND_BOTH but checkAndAdjudicate was calling
    settleForfeit() on join-window expiry, directly contradicting it.
    game.service.ts now reads this policy at adjudication time and calls
    settleNoShow() (full refund, no fees) instead of settleForfeit().
  */
  noShowPolicy: 'REFUND_BOTH',
  /*
    Turn timeout mid-game is still a forfeit — the player who ran out of time
    loses their stake. That is a separate, intentional policy from join-window no-show.
  */
  forfeitPolicy: 'NON_FORFEITING_PLAYER_TAKES_POT',
};
