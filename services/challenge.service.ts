import type { Challenge, GameType, MatchFormat } from '@/types/challenge';
import { readChallenge, writeChallenge, readAllChallenges } from '@/store/challenge.store';
import { writeMatch, readMatch } from '@/store/connect4.store';
import { escrowDebit } from './wallet.service';
import { genCode } from '@/lib/prng';
import { createEmptyBoard } from '@/lib/connect4/engine';
import { decodeChallengeInvite } from '@/lib/invite';
import { connect4Policy } from '@/config/connect4/policy';
import { CHALLENGE_EXPIRY_MS, JOIN_WINDOW_MS, ASYNC_MATCH_DEADLINE_MS } from '@/config/challenge';
import { defaultFeeStructure } from '@/config/fees';

/**
 * Create a challenge — creator's stake is immediately locked.
 * No challenge exists without funding. This prevents spam and
 * creates real psychological weight.
 */
export function createChallenge(input: {
  uid: string;
  gameType: GameType;
  stake: number;
  matchFormat?: MatchFormat;
  targetOpponentUid?: string;
}): Challenge {
  const { uid, gameType, stake, matchFormat = 'SINGLE', targetOpponentUid } = input;
  if (stake <= 0 || !Number.isFinite(stake)) throw new Error('INVALID_STAKE');

  // CREATOR FUNDS FIRST — debit immediately, fail loudly if insufficient
  escrowDebit(uid, stake);

  const code = genCode();
  const seed = (Math.random().toString(36).slice(2) + Date.now().toString(36)).toUpperCase();
  const now = Date.now();
  const isConnect4 = gameType === 'CONNECT4';

  const ch: Challenge = {
    code,
    gameType,
    seed,
    stake,
    matchFormat,
    feeStructure: defaultFeeStructure,
    status: 'AWAITING_OPPONENT',
    createdAt: now,
    expiresAt: now + (isConnect4 ? connect4Policy.openExpiresInMs : CHALLENGE_EXPIRY_MS),
    creatorUid: uid,
    targetOpponentUid,
    creatorAccepted: true,
    escrowedCreator: stake,
    mode: isConnect4 ? 'SYNC' : 'ASYNC',
    phase: isConnect4 ? 'WAITING_READY' : undefined,
    readyCreator: isConnect4 ? false : undefined,
    readyOpponent: isConnect4 ? false : undefined,
    turnNumber: isConnect4 ? 0 : undefined,
  };

  writeChallenge(ch);

  if (isConnect4) {
    writeMatch({
      challengeCode: code,
      challengeId: code,
      boardState: createEmptyBoard(),
      moves: [],
      phase: 'WAITING_READY',
    });
  }

  return ch;
}

/**
 * Opponent accepts and funds the challenge. Both stakes are now locked.
 * Status moves to FULLY_FUNDED → JOIN_WINDOW_STARTED.
 */
export function acceptChallenge(input: {
  code: string;
  uid: string;
}): Challenge {
  const { code, uid } = input;
  const ch = readChallenge(code);
  if (!ch) throw new Error('CHALLENGE_NOT_FOUND');
  if (ch.status !== 'AWAITING_OPPONENT') throw new Error('CHALLENGE_NOT_ACCEPTABLE');
  if (ch.creatorUid === uid) throw new Error('CANNOT_ACCEPT_OWN_CHALLENGE');
  if (Date.now() > ch.expiresAt) throw new Error('CHALLENGE_EXPIRED');
  if (ch.targetOpponentUid && ch.targetOpponentUid !== uid) throw new Error('NOT_INVITED');

  // Opponent funds — debit second
  escrowDebit(uid, ch.stake);

  const now = Date.now();
  ch.opponentUid = uid;
  ch.opponentAccepted = true;
  ch.escrowedOpponent = ch.stake;

  if (ch.gameType === 'CONNECT4') {
    // SYNC: presence matters. Both players must enter within the join window,
    // then ready up. Status holds at FULLY_FUNDED until both have entered.
    ch.status = 'FULLY_FUNDED';
    ch.joinWindowStartedAt = now;
    ch.joinDeadlineAt = now + JOIN_WINDOW_MS;
    ch.mode = 'SYNC';
    ch.phase = 'WAITING_READY';
    ch.readyDeadlineAt = now + connect4Policy.readyTimeoutMs;
    ch.readyCreator = Boolean(ch.readyCreator);
    ch.readyOpponent = false;

    const existing = readMatch(code);
    writeMatch(
      existing ?? {
        challengeCode: code,
        challengeId: code,
        boardState: createEmptyBoard(),
        moves: [],
        phase: 'WAITING_READY',
      }
    );
  } else {
    // ASYNC (Scout/Down/Up): each player runs their own seeded board, so there is
    // nothing to synchronise. Open the match immediately — no join window, no
    // no-show dead-end. A match deadline guarantees stakes can't strand if one
    // player never plays (see checkAndAdjudicate).
    ch.status = 'MATCH_ACTIVE';
    ch.creatorJoined = true;
    ch.opponentJoined = true;
    ch.matchDeadlineAt = now + ASYNC_MATCH_DEADLINE_MS;
  }

  writeChallenge(ch);
  return ch;
}

/**
 * Player joins the active match. When both have joined, status → MATCH_ACTIVE.
 */
export function joinMatch(input: { code: string; uid: string }): Challenge {
  const { code, uid } = input;
  const ch = readChallenge(code);
  if (!ch) throw new Error('CHALLENGE_NOT_FOUND');
  if (ch.status !== 'FULLY_FUNDED' && ch.status !== 'JOIN_WINDOW_STARTED' && ch.status !== 'MATCH_ACTIVE') {
    throw new Error('CHALLENGE_NOT_JOINABLE');
  }
  if (ch.joinDeadlineAt && Date.now() > ch.joinDeadlineAt) {
    throw new Error('JOIN_WINDOW_EXPIRED');
  }

  if (uid === ch.creatorUid) ch.creatorJoined = true;
  if (uid === ch.opponentUid) ch.opponentJoined = true;

  if (ch.status === 'FULLY_FUNDED') ch.status = 'JOIN_WINDOW_STARTED';

  if (ch.creatorJoined && ch.opponentJoined) {
    ch.status = 'MATCH_ACTIVE';
  }

  writeChallenge(ch);
  return ch;
}

export function getChallenge(code: string): Challenge | undefined {
  return readChallenge(code);
}

export function listChallenges(uid: string): Challenge[] {
  return readAllChallenges()
    .filter((ch) => ch.creatorUid === uid || ch.opponentUid === uid)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function hydrateChallengeFromInvite(encoded: string): Challenge | null {
  const invite = decodeChallengeInvite(encoded);
  if (!invite) return null;

  const existing = readChallenge(invite.code);
  if (existing) return existing;

  const ch: Challenge = {
    code: invite.code.toUpperCase(),
    gameType: invite.gameType,
    seed: invite.seed,
    stake: invite.stake,
    status: 'AWAITING_OPPONENT',
    matchFormat: invite.matchFormat ?? 'SINGLE',
    feeStructure: invite.feeStructure ?? defaultFeeStructure,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    creatorUid: invite.creatorUid,
    targetOpponentUid: invite.targetOpponentUid,
    creatorAccepted: true,
    escrowedCreator: invite.escrowedCreator ?? invite.stake,
    mode: invite.mode ?? (invite.gameType === 'CONNECT4' ? 'SYNC' : 'ASYNC'),
    phase: invite.phase ?? (invite.gameType === 'CONNECT4' ? 'WAITING_READY' : undefined),
    readyCreator: invite.readyCreator ?? (invite.gameType === 'CONNECT4' ? false : undefined),
    readyOpponent: invite.readyOpponent ?? (invite.gameType === 'CONNECT4' ? false : undefined),
    turnNumber: invite.turnNumber ?? (invite.gameType === 'CONNECT4' ? 0 : undefined),
  };

  writeChallenge(ch);

  if (ch.gameType === 'CONNECT4' && !readMatch(ch.code)) {
    writeMatch({
      challengeCode: ch.code,
      challengeId: ch.code,
      boardState: createEmptyBoard(),
      moves: [],
      phase: ch.phase ?? 'WAITING_READY',
    });
  }

  return ch;
}
