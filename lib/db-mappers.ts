/**
 * Translate the snake_case `challenges` row from Postgres into the camelCase
 * `Challenge` the React components have always consumed.
 *
 * Keep this the ONLY place we map field names — it's how Steps 3+4 swap the
 * source of truth from localStorage to the database without touching pages.
 */
import type { Challenge, Result } from '@/types/challenge';
import { defaultFeeStructure } from '@/config/fees';

type Row = Record<string, any>;

const toMs = (v: string | number | null | undefined): number | undefined =>
  v == null ? undefined : (typeof v === 'number' ? v : new Date(v).getTime());

export function rowToChallenge(r: Row): Challenge {
  // Settlement snapshot in the DB uses camelCase already (we wrote it that way
  // inside settle_challenge), so it forwards straight through.
  const snap = r.settlement_snapshot ?? undefined;

  const creatorResult: Result | undefined =
    r.creator_result_final_ms != null
      ? { rawMs: r.creator_result_final_ms, finalMs: r.creator_result_final_ms, finishedAt: toMs(r.creator_result_finished_at) ?? 0 }
      : undefined;
  const opponentResult: Result | undefined =
    r.opponent_result_final_ms != null
      ? { rawMs: r.opponent_result_final_ms, finalMs: r.opponent_result_final_ms, finishedAt: toMs(r.opponent_result_finished_at) ?? 0 }
      : undefined;

  return {
    code: r.code,
    gameType: r.game_type,
    seed: r.seed,
    stake: Number(r.stake),
    matchFormat: r.match_format ?? 'SINGLE',
    feeStructure: defaultFeeStructure,
    status: r.status,
    createdAt: toMs(r.created_at)!,
    expiresAt: toMs(r.expires_at)!,
    creatorUid: r.creator_id ?? undefined,
    opponentUid: r.opponent_id ?? undefined,
    targetOpponentUid: r.target_opponent_id ?? undefined,
    creatorAccepted: r.creator_id != null,
    opponentAccepted: r.opponent_id != null,
    escrowedCreator: r.escrowed_creator ?? undefined,
    escrowedOpponent: r.escrowed_opponent ?? undefined,
    creatorJoined: r.creator_joined ?? false,
    opponentJoined: r.opponent_joined ?? false,
    mode: r.mode ?? undefined,
    phase: r.phase ?? undefined,
    readyCreator: r.ready_creator ?? undefined,
    readyOpponent: r.ready_opponent ?? undefined,
    readyDeadlineAt: toMs(r.ready_deadline_at),
    turnDeadlineAt: toMs(r.turn_deadline_at),
    turnNumber: r.turn_number ?? undefined,
    currentTurnUid: r.current_turn_id ?? undefined,
    joinWindowStartedAt: toMs(r.join_window_started_at),
    joinDeadlineAt: toMs(r.join_deadline_at),
    matchDeadlineAt: toMs(r.match_deadline_at),
    winnerUid: r.winner_id ?? undefined,
    resultType: r.result_type ?? undefined,
    forfeitUid: r.forfeit_id ?? undefined,
    settled: r.settled ?? false,
    settlementTxId: r.settlement_tx_id ?? undefined,
    settlementSnapshot: snap,
    creatorResult,
    opponentResult,
  } as Challenge;
}

export function rowsToChallenges(rows: Row[] | null | undefined): Challenge[] {
  return (rows ?? []).map(rowToChallenge);
}
