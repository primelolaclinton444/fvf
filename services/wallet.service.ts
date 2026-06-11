import {
  getRawBalance,
  setRawBalance,
  seedStarterBalance,
} from '@/store/wallet.store';

export function getBalance(uid: string): number {
  return getRawBalance(uid);
}

export function topUp(uid: string, amount: number): number {
  const next = getRawBalance(uid) + amount;
  setRawBalance(uid, next);
  return next;
}

/**
 * Lock stake into escrow. Throws INSUFFICIENT_FUNDS if balance too low.
 * In Phase 3 this becomes a USDC.approve + contract.fund() call.
 */
export function escrowDebit(uid: string, amount: number): number {
  const cur = getRawBalance(uid);
  if (cur < amount) throw new Error('INSUFFICIENT_FUNDS');
  const next = cur - amount;
  setRawBalance(uid, next);
  return next;
}

/**
 * Credit a player (payout or refund from escrow).
 * In Phase 3 this is the contract.settle() payout.
 */
export function escrowCredit(uid: string, amount: number): number {
  const next = getRawBalance(uid) + amount;
  setRawBalance(uid, next);
  return next;
}

export function initWallet(uid: string): void {
  seedStarterBalance(uid);
}
