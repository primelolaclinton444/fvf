import type { Challenge, ChallengeInvite } from '@/types/challenge';

export function encodeChallengeInvite(challenge: Challenge): string {
  const invite: ChallengeInvite = {
    code: challenge.code,
    gameType: challenge.gameType,
    seed: challenge.seed,
    stake: challenge.stake,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
    creatorUid: challenge.creatorUid,
    escrowedCreator: challenge.escrowedCreator,
    mode: challenge.mode,
    phase: challenge.phase,
    readyCreator: challenge.readyCreator,
    readyOpponent: challenge.readyOpponent,
    turnNumber: challenge.turnNumber,
    matchFormat: challenge.matchFormat,
    feeStructure: challenge.feeStructure,
    targetOpponentUid: challenge.targetOpponentUid,
  };
  return window.btoa(encodeURIComponent(JSON.stringify(invite)));
}

export function decodeChallengeInvite(encoded: string): ChallengeInvite | null {
  try {
    const invite = JSON.parse(decodeURIComponent(window.atob(encoded))) as ChallengeInvite;
    if (
      !invite.code || !invite.gameType || !invite.seed ||
      !Number.isFinite(invite.stake) || invite.stake <= 0 ||
      !invite.creatorUid ||
      !Number.isFinite(invite.createdAt) ||
      !Number.isFinite(invite.expiresAt)
    ) return null;
    return invite;
  } catch {
    return null;
  }
}
