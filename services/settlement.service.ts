import type { Challenge } from '@/types/challenge';
import { escrowCredit } from './wallet.service';
import { writeChallenge } from '@/store/challenge.store';
import { DEVELOPER_WALLET_UID, PROTOCOL_WALLET_UID } from '@/config/fees';

export type SettlementReceipt = {
  settlementTxId: string;
  pot: number;
  winnerAmount: number;
  developerAmount: number;
  protocolAmount: number;
  winnerUid: string | null;
  reason: string;
  finalizedAt: number;
};

function buildTxId(prefix: string, code: string): string {
  return `${prefix}_${code}_${Date.now()}`;
}

function computeSplits(pot: number, ch: Challenge): { winnerAmount: number; developerAmount: number; protocolAmount: number } {
  const devPct = ch.feeStructure?.developerFeePct ?? 0;
  const protoPct = ch.feeStructure?.protocolFeePct ?? 0;
  const developerAmount = Math.floor((pot * devPct) / 100);
  const protocolAmount = Math.floor((pot * protoPct) / 100);
  const winnerAmount = pot - developerAmount - protocolAmount;
  return { winnerAmount, developerAmount, protocolAmount };
}

/**
 * Settle an async game (Scout / Down / Up). Determines winner from result times.
 * Idempotent — guards against double-payout.
 */
export function settleAsync(ch: Challenge): SettlementReceipt | null {
  if (ch.settled) return existingReceipt(ch);

  const a = ch.creatorResult?.finalMs ?? Infinity;
  const b = ch.opponentResult?.finalMs ?? Infinity;
  if (!isFinite(a) || !isFinite(b)) return null;

  const pot = (ch.escrowedCreator ?? 0) + (ch.escrowedOpponent ?? 0);
  let winnerUid: string | null = null;
  let reason = 'TIE';

  if (a < b) { winnerUid = ch.creatorUid ?? null; reason = 'WIN'; }
  else if (b < a) { winnerUid = ch.opponentUid ?? null; reason = 'WIN'; }

  ch.status = 'RESULT_VERIFIED';
  ch.winnerUid = winnerUid ?? undefined;
  ch.resultType = reason === 'TIE' ? 'DRAW' : 'WIN';

  if (reason === 'TIE') {
    // Refund each side — no fees on draws
    if (ch.creatorUid) escrowCredit(ch.creatorUid, ch.escrowedCreator ?? 0);
    if (ch.opponentUid) escrowCredit(ch.opponentUid, ch.escrowedOpponent ?? 0);
    return finalize(ch, { pot, winnerUid: null, winnerAmount: 0, developerAmount: 0, protocolAmount: 0, reason });
  }

  const { winnerAmount, developerAmount, protocolAmount } = computeSplits(pot, ch);
  if (winnerUid) escrowCredit(winnerUid, winnerAmount);
  if (developerAmount > 0) escrowCredit(DEVELOPER_WALLET_UID, developerAmount);
  if (protocolAmount > 0) escrowCredit(PROTOCOL_WALLET_UID, protocolAmount);

  return finalize(ch, { pot, winnerUid, winnerAmount, developerAmount, protocolAmount, reason });
}

/**
 * Settle Connect 4 — winnerUid already determined by game.service via
 * commitAuthoritativeMove. We just pay out.
 */
export function settleConnect4(ch: Challenge): SettlementReceipt | null {
  if (ch.settled) return existingReceipt(ch);

  const pot = (ch.escrowedCreator ?? 0) + (ch.escrowedOpponent ?? 0);
  ch.status = 'RESULT_VERIFIED';

  if (ch.resultType === 'DRAW') {
    if (ch.creatorUid) escrowCredit(ch.creatorUid, ch.escrowedCreator ?? 0);
    if (ch.opponentUid) escrowCredit(ch.opponentUid, ch.escrowedOpponent ?? 0);
    return finalize(ch, { pot, winnerUid: null, winnerAmount: 0, developerAmount: 0, protocolAmount: 0, reason: 'DRAW' });
  }

  const winnerUid = ch.winnerUid ?? null;
  const { winnerAmount, developerAmount, protocolAmount } = computeSplits(pot, ch);
  if (winnerUid) escrowCredit(winnerUid, winnerAmount);
  if (developerAmount > 0) escrowCredit(DEVELOPER_WALLET_UID, developerAmount);
  if (protocolAmount > 0) escrowCredit(PROTOCOL_WALLET_UID, protocolAmount);

  return finalize(ch, { pot, winnerUid, winnerAmount, developerAmount, protocolAmount, reason: ch.resultType ?? 'WIN' });
}

/**
 * Refund creator when challenge expired without opponent.
 */
export function settleExpiredRefund(ch: Challenge): SettlementReceipt | null {
  if (ch.settled) return existingReceipt(ch);

  if (ch.creatorUid && ch.escrowedCreator) {
    escrowCredit(ch.creatorUid, ch.escrowedCreator);
  }
  ch.status = 'CREATOR_REFUNDED';

  const pot = ch.escrowedCreator ?? 0;
  return finalize(ch, { pot, winnerUid: null, winnerAmount: pot, developerAmount: 0, protocolAmount: 0, reason: 'REFUND' });
}

/**
 * Forfeit — one player no-showed. Present player gets the pot minus fees.
 */
export function settleForfeit(ch: Challenge, forfeitUid: string): SettlementReceipt | null {
  if (ch.settled) return existingReceipt(ch);

  const winnerUid = forfeitUid === ch.creatorUid ? ch.opponentUid : ch.creatorUid;
  ch.forfeitUid = forfeitUid;
  ch.winnerUid = winnerUid;
  ch.resultType = 'FORFEIT';
  ch.status = 'FORFEIT';

  const pot = (ch.escrowedCreator ?? 0) + (ch.escrowedOpponent ?? 0);
  const { winnerAmount, developerAmount, protocolAmount } = computeSplits(pot, ch);

  if (winnerUid) escrowCredit(winnerUid, winnerAmount);
  if (developerAmount > 0) escrowCredit(DEVELOPER_WALLET_UID, developerAmount);
  if (protocolAmount > 0) escrowCredit(PROTOCOL_WALLET_UID, protocolAmount);

  ch.status = 'PRESENT_PLAYER_PAID';
  return finalize(ch, { pot, winnerUid: winnerUid ?? null, winnerAmount, developerAmount, protocolAmount, reason: 'FORFEIT' });
}

function finalize(ch: Challenge, parts: { pot: number; winnerUid: string | null; winnerAmount: number; developerAmount: number; protocolAmount: number; reason: string }): SettlementReceipt {
  const txId = buildTxId('settle', ch.code);
  const finalizedAt = Date.now();

  ch.settled = true;
  ch.settlementTxId = txId;
  ch.settlementSnapshot = {
    pot: parts.pot,
    winnerAmount: parts.winnerAmount,
    developerAmount: parts.developerAmount,
    protocolAmount: parts.protocolAmount,
    winnerUid: parts.winnerUid,
    reason: parts.reason as any,
    finalizedAt,
  };
  if (ch.status !== 'CREATOR_REFUNDED' && ch.status !== 'PRESENT_PLAYER_PAID') {
    ch.status = 'SETTLED';
  }
  writeChallenge(ch);

  return {
    settlementTxId: txId,
    pot: parts.pot,
    winnerAmount: parts.winnerAmount,
    developerAmount: parts.developerAmount,
    protocolAmount: parts.protocolAmount,
    winnerUid: parts.winnerUid,
    reason: parts.reason,
    finalizedAt,
  };
}

function existingReceipt(ch: Challenge): SettlementReceipt | null {
  if (!ch.settlementSnapshot || !ch.settlementTxId) return null;
  return {
    settlementTxId: ch.settlementTxId,
    pot: ch.settlementSnapshot.pot,
    winnerAmount: ch.settlementSnapshot.winnerAmount,
    developerAmount: ch.settlementSnapshot.developerAmount,
    protocolAmount: ch.settlementSnapshot.protocolAmount,
    winnerUid: ch.settlementSnapshot.winnerUid,
    reason: ch.settlementSnapshot.reason,
    finalizedAt: ch.settlementSnapshot.finalizedAt,
  };
}
