import type { Challenge, Result } from '@/types/challenge';
import type { Connect4MatchState } from '@/types/connect4';
import { readChallenge, writeChallenge } from '@/store/challenge.store';
import { readMatch, writeMatch } from '@/store/connect4.store';
import { prngFromSeed, seededPickUnique } from '@/lib/prng';
import { applyMove, detectWinner, isDraw, type Connect4Board, type Connect4Player } from '@/lib/connect4/engine';
import { settleAsync, settleConnect4, settleExpiredRefund, settleForfeit, settleNoShow } from './settlement.service';
import { connect4Policy } from '@/config/connect4/policy';

// ─── Async result validation (tamper-resistant) ──────────────────────────────

export type AsyncMoveRecord = {
  value: number;
  timestamp: number;
};

const MIN_PLAUSIBLE_MS = 500;

export function submitAsyncResult(input: {
  code: string;
  role: 'creator' | 'opponent';
  uid: string;
  moves: AsyncMoveRecord[];
}): Challenge {
  const { code, role, uid, moves } = input;
  const ch = readChallenge(code);
  if (!ch) throw new Error('CHALLENGE_NOT_FOUND');
  if (ch.status !== 'MATCH_ACTIVE') throw new Error('MATCH_NOT_ACTIVE');

  if (role === 'creator' && ch.creatorResult) throw new Error('ALREADY_SUBMITTED');
  if (role === 'opponent' && ch.opponentResult) throw new Error('ALREADY_SUBMITTED');

  validateMoveSequence(ch, moves);

  const finalMs = moves[moves.length - 1].timestamp - moves[0].timestamp;
  if (finalMs < MIN_PLAUSIBLE_MS) throw new Error('IMPLAUSIBLE_TIME');

  const result: Result = { rawMs: finalMs, finalMs, finishedAt: Date.now() };
  if (role === 'creator') ch.creatorResult = result;
  else ch.opponentResult = result;

  writeChallenge(ch);

  const bothDone = Boolean(ch.creatorResult && ch.opponentResult);
  if (bothDone && !ch.settled) settleAsync(ch);

  return ch;
}

function validateMoveSequence(ch: Challenge, moves: AsyncMoveRecord[]): void {
  if (ch.gameType === 'SCOUT') {
    const rnd = prngFromSeed('targets-' + ch.seed);
    const targets = seededPickUnique(Array.from({ length: 25 }, (_, i) => i + 1), 5, rnd);
    if (moves.length !== 5) throw new Error('INVALID_MOVE_COUNT');
    const seen = new Set<number>();
    for (const m of moves) {
      if (!targets.includes(m.value)) throw new Error('INVALID_MOVE_VALUE');
      if (seen.has(m.value)) throw new Error('DUPLICATE_MOVE');
      seen.add(m.value);
    }
  } else if (ch.gameType === 'DOWN') {
    if (moves.length !== 25) throw new Error('INVALID_MOVE_COUNT');
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].value !== 25 - i) throw new Error('INVALID_MOVE_ORDER');
    }
  } else if (ch.gameType === 'UP') {
    if (moves.length !== 25) throw new Error('INVALID_MOVE_COUNT');
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].value !== i + 1) throw new Error('INVALID_MOVE_ORDER');
    }
  }
}

// ─── Connect 4 ────────────────────────────────────────────────────────────────

export function submitConnect4Move(input: {
  code: string;
  uid: string;
  col: number;
}): { ch: Challenge; match: Connect4MatchState } {
  const { code, uid, col } = input;
  const ch = readChallenge(code);
  const match = readMatch(code);
  if (!ch || !match) throw new Error('CHALLENGE_NOT_FOUND');
  if (ch.status !== 'MATCH_ACTIVE') throw new Error('MATCH_NOT_ACTIVE');
  if (ch.phase !== 'IN_PROGRESS') throw new Error('INVALID_PHASE');
  if (ch.currentTurnUid !== uid) throw new Error('NOT_YOUR_TURN');
  if (ch.turnDeadlineAt && Date.now() > ch.turnDeadlineAt) throw new Error('DEADLINE_EXPIRED');

  const player: Connect4Player = uid === ch.creatorUid ? 1 : 2;
  const { board } = applyMove(match.boardState as Connect4Board, col, player);
  const moves = [...match.moves, { moveIndex: match.moves.length, actorUid: uid, col, timestamp: Date.now() }];

  const updatedMatch: Connect4MatchState = { ...match, boardState: board, moves };

  const winner = detectWinner(board);
  const draw = isDraw(board);

  if (winner || draw) {
    updatedMatch.phase = 'COMPLETE';
    updatedMatch.endedAt = Date.now();
    ch.phase = 'COMPLETE';
    ch.resultType = winner ? 'WIN' : 'DRAW';
    ch.winnerUid = winner ? uid : undefined;

    writeChallenge(ch);
    writeMatch(updatedMatch);
    settleConnect4(ch);
    return { ch, match: updatedMatch };
  }

  ch.currentTurnUid = uid === ch.creatorUid ? ch.opponentUid : ch.creatorUid;
  ch.turnNumber = (ch.turnNumber ?? 1) + 1;
  ch.turnDeadlineAt = Date.now() + connect4Policy.turnTimeoutMs;

  writeChallenge(ch);
  writeMatch(updatedMatch);
  return { ch, match: updatedMatch };
}

export function submitConnect4Ready(input: { code: string; uid: string; ready: boolean }): { ch: Challenge; match: Connect4MatchState } {
  const { code, uid, ready } = input;
  const ch = readChallenge(code);
  const match = readMatch(code);
  if (!ch || !match) throw new Error('CHALLENGE_NOT_FOUND');
  if (!ch.creatorAccepted || !ch.opponentAccepted) throw new Error('STAKES_NOT_LOCKED');

  /*
    FIX BUG 5: guard against ready calls before both players have joined.
    Without this, both players can toggle ready while status is still FULLY_FUNDED,
    which transitions phase to IN_PROGRESS before status reaches MATCH_ACTIVE.
    submitConnect4Move then throws MATCH_NOT_ACTIVE on every move, deadlocking the game.
  */
  if (ch.status !== 'MATCH_ACTIVE') throw new Error('MATCH_NOT_ACTIVE');

  if (uid === ch.creatorUid) ch.readyCreator = ready;
  else if (uid === ch.opponentUid) ch.readyOpponent = ready;
  else throw new Error('NOT_A_PARTICIPANT');

  if (!ch.readyDeadlineAt) ch.readyDeadlineAt = Date.now() + connect4Policy.readyTimeoutMs;

  if (ch.readyCreator && ch.readyOpponent) {
    ch.phase = 'IN_PROGRESS';
    ch.currentTurnUid = ch.creatorUid;
    ch.turnNumber = 1;
    ch.turnDeadlineAt = Date.now() + connect4Policy.turnTimeoutMs;
    const updatedMatch: Connect4MatchState = { ...match, phase: 'IN_PROGRESS', startedAt: Date.now() };
    writeChallenge(ch);
    writeMatch(updatedMatch);
    return { ch, match: updatedMatch };
  }

  writeChallenge(ch);
  return { ch, match };
}

/**
 * Check deadlines and adjudicate. Called on every poll cycle from PlayPage.
 */
export function checkAndAdjudicate(code: string, now: number): void {
  const ch = readChallenge(code);
  if (!ch || ch.settled) return;

  // Challenge expired with no opponent — refund creator
  if (ch.status === 'AWAITING_OPPONENT' && now > ch.expiresAt) {
    ch.status = 'EXPIRED';
    writeChallenge(ch);
    settleExpiredRefund(ch);
    return;
  }

  // Join window expired
  if (
    (ch.status === 'FULLY_FUNDED' || ch.status === 'JOIN_WINDOW_STARTED') &&
    ch.joinDeadlineAt &&
    now > ch.joinDeadlineAt
  ) {
    const bothJoined = ch.creatorJoined && ch.opponentJoined;
    if (!bothJoined) {
      /*
        FIX BUG 7: connect4Policy.noShowPolicy === 'REFUND_BOTH'.
        Previously the code ignored this setting and always called settleForfeit,
        which punished the absent player. Now we honour the policy: if either or
        both players didn't show up in time, both stakes are returned in full.
        Turn timeout mid-game still calls settleForfeit — that is intentional and
        separate from the join-window no-show scenario.
      */
      ch.status = 'ONE_PLAYER_ABSENT';
      writeChallenge(ch);
      settleNoShow(ch);
      return;
    }
  }

  // Connect 4 turn timeout — the player who let their clock run out forfeits
  if (ch.gameType === 'CONNECT4' && ch.phase === 'IN_PROGRESS' && ch.turnDeadlineAt && now > ch.turnDeadlineAt) {
    const forfeitUid = ch.currentTurnUid ?? '';
    if (forfeitUid) {
      settleForfeit(ch, forfeitUid);
    }
  }
}
