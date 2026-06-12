'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import { Shell } from '@/components/ui/Shell';
import { CopyableCode } from '@/components/ui/CopyableCode';
import { useGameTimer } from '@/hooks/useGameTimer';
import { getChallenge, joinMatch, requestAdjudication } from '@/services/challenge.service';
import { encodeChallengeInvite } from '@/lib/invite';
import { submitAsyncResult, submitConnect4Move, submitConnect4Ready, type AsyncMoveRecord } from '@/services/game.service';
import { gameGridFromSeed, prngFromSeed, seededPickUnique } from '@/lib/prng';
import { gameTitle, formatSeconds } from '@/lib/format';
import type { Challenge } from '@/types/challenge';
import type { Connect4MatchState } from '@/types/connect4';
import { readMatchAsync } from '@/store/connect4.store';
import { subscribeToChallenge } from '@/lib/realtime';

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const params = useSearchParams();
  const urlRole = (params.get('role') as 'creator' | 'opponent') || 'creator';
  const { uid } = useAuth();
  const { refresh } = useWallet();
  const router = useRouter();
  const [ch, setCh] = useState<Challenge | null>(null);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const prevStatus = useRef<string | null>(null);

  // Role from identity — URL is fallback only.
  const role: 'creator' | 'opponent' = useMemo(() => {
    if (ch && uid) {
      if (ch.creatorUid === uid) return 'creator';
      if (ch.opponentUid === uid) return 'opponent';
    }
    return urlRole;
  }, [ch, uid, urlRole]);

  const sync = async () => {
    const latest = await getChallenge(code);
    if (latest) setCh(latest);
  };

  useEffect(() => { void sync(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code, uid]);

  // Realtime: re-fetch on any change to this challenge or its connect4 match.
  useEffect(() => {
    const unsub = subscribeToChallenge(code, () => { void sync(); });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Light tick for countdown labels + opportunistic adjudicate when a deadline
  // crosses (cron still runs every 15s; this just makes "your" tab snappier).
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  // Hint the server to adjudicate as deadlines pass — server is idempotent, so
  // safe to spam lightly. This is purely a latency optimisation for active tabs.
  useEffect(() => {
    if (!ch || ch.settled) return;
    const checks = [ch.expiresAt, ch.joinDeadlineAt, ch.matchDeadlineAt, ch.turnDeadlineAt].filter(Boolean) as number[];
    if (checks.some(t => Math.abs(t - now) < 1500)) {
      void requestAdjudication(ch.code);
    }
  }, [ch, now]);

  // Acceptance banner — fires when the creator's tab transitions out of AWAITING_OPPONENT.
  useEffect(() => {
    if (!ch) return;
    const prev = prevStatus.current;
    if (prev === 'AWAITING_OPPONENT' && ch.status !== 'AWAITING_OPPONENT') {
      setNotice(
        ch.gameType === 'CONNECT4'
          ? 'Opponent accepted — both stakes locked. Enter the match to ready up.'
          : 'Opponent accepted — both stakes locked. Play your run.',
      );
    }
    prevStatus.current = ch.status;
  }, [ch?.status, ch?.gameType]); // eslint-disable-line react-hooks/exhaustive-deps

  const onEnterMatch = async () => {
    try { await joinMatch({ code, uid }); await sync(); }
    catch (e) { console.warn('[enterMatch]', e instanceof Error ? e.message : e); }
  };

  const banner = notice ? (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%]">
      <div className="flex items-start gap-3 rounded-xl border border-green-500/40 bg-green-500/10 backdrop-blur px-4 py-3 text-sm text-green-200 shadow-lg">
        <span className="flex-1">{notice}</span>
        <button onClick={() => setNotice(null)} className="text-green-300/70 hover:text-green-200">✕</button>
      </div>
    </div>
  ) : null;

  const view = (() => {
    if (!ch) {
      return (
        <Shell showBack onBack={() => router.push('/arcade')}>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 max-w-xl">
            <h2 className="text-xl font-bold mb-2">Challenge Not Found</h2>
          </div>
        </Shell>
      );
    }

    if (ch.status === 'SETTLED' || ch.status === 'CREATOR_REFUNDED' || ch.status === 'PRESENT_PLAYER_PAID' ||
        ch.status === 'FORFEIT' || (ch as any).status === 'BOTH_REFUNDED') {
      return <ResultView ch={ch} role={role} onBack={() => router.push('/arcade')} />;
    }

    if (ch.status === 'AWAITING_OPPONENT') {
      return <AwaitingOpponentView ch={ch} now={now} onBack={() => router.push('/arcade')} />;
    }

    if (ch.status === 'FULLY_FUNDED' || ch.status === 'JOIN_WINDOW_STARTED') {
      return <JoinWindowView ch={ch} role={role} now={now} onEnter={onEnterMatch} onBack={() => router.push('/arcade')} />;
    }

    if (ch.status === 'MATCH_ACTIVE') {
      if (ch.gameType === 'CONNECT4') return <Connect4Play ch={ch} now={now} onSync={sync} onBack={() => router.push('/arcade')} />;
      return <AsyncPlay ch={ch} role={role} onSync={sync} onBack={() => router.push('/arcade')} />;
    }

    return null;
  })();

  return <>{banner}{view}</>;
}

// ── Money state chip ──────────────────────────────────────────────────────────

function StakeChip({ label, tone }: { label: string; tone: 'locked' | 'risk' | 'won' | 'safe' }) {
  const tones: Record<string, string> = {
    locked: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
    risk:   'border-red-500/30    bg-red-500/10    text-red-300',
    won:    'border-green-500/30  bg-green-500/10  text-green-300',
    safe:   'border-zinc-700      bg-zinc-900      text-zinc-300',
  };
  return <span className={`inline-block text-[11px] px-2 py-1 rounded-full border ${tones[tone]}`}>{label}</span>;
}

// ── Awaiting opponent ─────────────────────────────────────────────────────────

function AwaitingOpponentView({ ch, now, onBack }: { ch: Challenge; now: number; onBack: () => void }) {
  const invite = typeof window !== 'undefined' ? encodeChallengeInvite(ch) : '';
  const shareUrl = (() => {
    if (typeof window === 'undefined') return '';
    const u = new URL(window.location.href);
    u.pathname = `/challenge/join/${ch.code}`;
    u.search = invite ? `?invite=${encodeURIComponent(invite)}` : '';
    return u.toString();
  })();

  return (
    <Shell showBack onBack={onBack}>
      <div className="max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Waiting for opponent</h1>
          <StakeChip label={`${ch.stake} locked`} tone="locked" />
        </div>
        <p className="text-sm text-zinc-400 mb-4">
          Your stake of {ch.stake} coins is held in escrow. Share the invite link below — this page updates the instant they accept.
        </p>

        {shareUrl && (
          <div className="mb-4">
            <CopyableCode label="Invite link" value={shareUrl} />
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
          <span>Code: <span className="font-mono text-white">{ch.code}</span></span>
          <span>Expires in <span className="font-mono text-yellow-300">{formatSeconds(ch.expiresAt - now)}</span></span>
        </div>
        <p className="text-[11px] text-zinc-600 mt-3">If it expires with no opponent, your stake is refunded automatically.</p>
      </div>
    </Shell>
  );
}

// ── Connect 4 join window ─────────────────────────────────────────────────────

function JoinWindowView({
  ch, role, now, onEnter, onBack,
}: {
  ch: Challenge; role: 'creator' | 'opponent'; now: number; onEnter: () => void; onBack: () => void;
}) {
  const youJoined = role === 'creator' ? ch.creatorJoined : ch.opponentJoined;
  const otherJoined = role === 'creator' ? ch.opponentJoined : ch.creatorJoined;
  const remaining = ch.joinDeadlineAt ? ch.joinDeadlineAt - now : 0;

  return (
    <Shell showBack onBack={onBack}>
      <div className="max-w-2xl rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase text-yellow-400">Both stakes locked</div>
          <StakeChip label={`${ch.stake} at risk`} tone="risk" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Enter the arena</h1>
        <p className="text-sm text-zinc-300 mb-4">
          Tap below within <span className="font-mono text-white">{formatSeconds(remaining)}</span> to enter.
          If either player doesn&apos;t enter in time, both stakes are refunded in full.
        </p>

        <div className="space-y-2 mb-5">
          <div className="text-sm">You: {youJoined ? <span className="text-green-400">In</span> : <span className="text-yellow-300">Not entered</span>}</div>
          <div className="text-sm">Opponent: {otherJoined ? <span className="text-green-400">In</span> : <span className="text-zinc-400">Waiting…</span>}</div>
        </div>

        {!youJoined ? (
          <button onClick={onEnter} className="w-full px-4 py-3 rounded-lg bg-white text-black font-semibold">Enter Match</button>
        ) : (
          <div className="text-sm text-zinc-400">You&apos;re in. Waiting for your opponent to enter — the match starts the moment they do.</div>
        )}
      </div>
    </Shell>
  );
}

// ── Async play ────────────────────────────────────────────────────────────────

function AsyncPlay({ ch, role, onSync, onBack }: { ch: Challenge; role: 'creator' | 'opponent'; onSync: () => Promise<void>; onBack: () => void }) {
  const { uid } = useAuth();
  const { refresh } = useWallet();
  const yourResult  = role === 'creator' ? ch.creatorResult  : ch.opponentResult;
  const otherResult = role === 'creator' ? ch.opponentResult : ch.creatorResult;
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onDone = async (moves: AsyncMoveRecord[]) => {
    setErr(null); setSubmitting(true);
    try {
      await submitAsyncResult({ code: ch.code, role, uid, moves });
      await refresh();
      await onSync();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell showBack onBack={onBack}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-400">Challenge</div>
              <div className="text-2xl font-mono font-bold">{ch.code}</div>
            </div>
            <StakeChip label={`${ch.stake} at risk`} tone="risk" />
          </div>
          {yourResult ? (
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
              <div className="text-sm text-zinc-400">Your time</div>
              <div className="text-2xl font-mono font-bold">{(yourResult.finalMs / 1000).toFixed(6)}s</div>
              <div className="text-xs text-zinc-500 mt-2">
                {otherResult ? 'Settling…' : 'Submitted — waiting for opponent to finish their run.'}
              </div>
            </div>
          ) : (
            <>
              {ch.gameType === 'SCOUT' && <SeededScout seed={ch.seed} disabled={submitting} onDone={onDone} />}
              {ch.gameType === 'DOWN'  && <SeededDown  seed={ch.seed} disabled={submitting} onDone={onDone} />}
              {ch.gameType === 'UP'    && <SeededUp    seed={ch.seed} disabled={submitting} onDone={onDone} />}
            </>
          )}
          {err && <div className="text-sm text-red-400 mt-3">{err}</div>}
        </div>
        <aside className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-lg font-bold mb-2">Match</h3>
          <div className="text-sm text-zinc-400">Stake each: {ch.stake} · Pot {ch.stake * 2}</div>
          <div className="text-xs text-zinc-500 mt-2">Game: {gameTitle(ch.gameType)}</div>
          <ul className="text-sm text-zinc-400 space-y-1 mt-3">
            <li>You: {yourResult ? <span className="text-green-400">Done</span> : <span className="text-yellow-300">Playing…</span>}</li>
            <li>Opponent: {otherResult ? <span className="text-green-400">Done</span> : <span className="text-zinc-400">Playing…</span>}</li>
          </ul>
          <p className="text-[11px] text-zinc-600 mt-3">Both run the same board independently. Fastest valid time wins.</p>
        </aside>
      </div>
    </Shell>
  );
}

function SeededScout({ seed, disabled, onDone }: { seed: string; disabled: boolean; onDone: (m: AsyncMoveRecord[]) => void }) {
  const grid    = useMemo(() => gameGridFromSeed(seed), [seed]);
  const targets = useMemo(() => { const rnd = prngFromSeed('targets-' + seed); return seededPickUnique(Array.from({ length: 25 }, (_, i) => i + 1), 5, rnd); }, [seed]);
  const { started, live, start } = useGameTimer();
  const [found, setFound] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const [moves] = useState<AsyncMoveRecord[]>([]);

  const click = (n: number) => {
    if (!started || done || disabled || !targets.includes(n) || found.includes(n)) return;
    moves.push({ value: n, timestamp: performance.now() });
    const nxt = [...found, n];
    setFound(nxt);
    if (nxt.length === 5) { setDone(true); onDone([...moves]); }
  };
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}
        <div className="text-lg tabular-nums font-mono">Time: {live}s</div>
      </div>
      <div className="flex items-center gap-2 mb-3">
        {targets.map((t, i) => <span key={i} className={`px-3 py-1 rounded-full text-lg font-bold border ${found.includes(t) ? 'bg-green-500 text-black border-green-500' : 'bg-zinc-900 border-zinc-800'}`}>{t}</span>)}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {grid.map((num, idx) => <button key={idx} onClick={() => click(num)} disabled={found.includes(num) || done || disabled} className={`w-14 h-14 text-xl font-bold rounded-lg ${found.includes(num) ? 'bg-green-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}>{num}</button>)}
      </div>
    </div>
  );
}

function SeededDown({ seed, disabled, onDone }: { seed: string; disabled: boolean; onDone: (m: AsyncMoveRecord[]) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const { started, live, start } = useGameTimer();
  const [next, setNext] = useState(25);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);
  const [moves] = useState<AsyncMoveRecord[]>([]);

  const click = (n: number) => {
    if (!started || done || disabled || n !== next) return;
    moves.push({ value: n, timestamp: performance.now() });
    const nf = new Set(found).add(n); setFound(nf);
    if (next === 1) { setDone(true); onDone([...moves]); } else setNext(v => v - 1);
  };
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}
        <div className="text-lg tabular-nums font-mono">Time: {live}s</div>
        <div className="text-sm text-zinc-400">Next: <span className="font-bold text-white">{done ? '-' : next}</span></div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {grid.map((num, idx) => <button key={idx} onClick={() => click(num)} disabled={found.has(num) || done || disabled} className={`w-14 h-14 text-xl font-bold rounded-lg ${found.has(num) ? 'bg-green-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}>{num}</button>)}
      </div>
    </div>
  );
}

function SeededUp({ seed, disabled, onDone }: { seed: string; disabled: boolean; onDone: (m: AsyncMoveRecord[]) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const { started, live, start } = useGameTimer();
  const [next, setNext] = useState(1);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);
  const [moves] = useState<AsyncMoveRecord[]>([]);

  const click = (n: number) => {
    if (!started || done || disabled || n !== next) return;
    moves.push({ value: n, timestamp: performance.now() });
    const nf = new Set(found).add(n); setFound(nf);
    if (next === 25) { setDone(true); onDone([...moves]); } else setNext(v => v + 1);
  };
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}
        <div className="text-lg tabular-nums font-mono">Time: {live}s</div>
        <div className="text-sm text-zinc-400">Next: <span className="font-bold text-white">{done ? '-' : next}</span></div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {grid.map((num, idx) => <button key={idx} onClick={() => click(num)} disabled={found.has(num) || done || disabled} className={`w-14 h-14 text-xl font-bold rounded-lg ${found.has(num) ? 'bg-green-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}>{num}</button>)}
      </div>
    </div>
  );
}

// ── Connect 4 play ────────────────────────────────────────────────────────────

function Connect4Play({ ch, now, onSync, onBack }: { ch: Challenge; now: number; onSync: () => Promise<void>; onBack: () => void }) {
  const { uid } = useAuth();
  const [match, setMatch] = useState<Connect4MatchState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () => { void readMatchAsync(ch.code).then(m => { if (alive && m) setMatch(m); }); };
    pull();
    // Subscribed already by the parent's subscribeToChallenge (it filters
    // connect4_matches by challenge_code), but we also pull on a slow tick.
    const id = setInterval(pull, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [ch.code]);

  if (!match) return null;

  const isMyTurn = ch.phase === 'IN_PROGRESS' && ch.currentTurnUid === uid;
  const deadline = ch.phase === 'WAITING_READY' ? ch.readyDeadlineAt : ch.turnDeadlineAt;
  const timer    = deadline ? formatSeconds(deadline - now) : '--';
  const myReady  = uid === ch.creatorUid ? ch.readyCreator : ch.readyOpponent;

  const onMove = async (col: number) => {
    setErr(null);
    try { await submitConnect4Move({ code: ch.code, uid, col }); await onSync(); }
    catch (e) { setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error'); }
  };
  const onReady = async () => {
    setErr(null);
    try { await submitConnect4Ready({ code: ch.code, uid, ready: !myReady }); await onSync(); }
    catch (e) { setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error'); }
  };

  return (
    <Shell showBack onBack={onBack}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-400">Connect 4 · {ch.code}</div>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full bg-yellow-400 text-black font-bold">SYNC</span>
          </div>

          {ch.phase === 'WAITING_READY' && (
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 mb-4">
              <h3 className="font-bold mb-2">Ready Room</h3>
              <p className="text-sm text-zinc-400 mb-3">Countdown: <span className="font-mono text-white">{timer}</span></p>
              <button onClick={onReady} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">
                {myReady ? 'Unready' : 'Ready'}
              </button>
            </div>
          )}

          {ch.phase === 'IN_PROGRESS' && (
            <>
              <div className="flex justify-between mb-3 text-sm">
                <div>{isMyTurn ? 'Your turn' : "Opponent's turn"}</div>
                <div className="font-mono">Turn {ch.turnNumber}: {timer}</div>
              </div>
              <Connect4Board board={match.boardState} disabled={!isMyTurn} onMove={onMove} />
            </>
          )}

          {err && <div className="text-sm text-red-400 mt-3">{err}</div>}
        </div>
        <aside className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-lg font-bold mb-2">Match</h3>
          <ul className="text-sm text-zinc-400 space-y-1">
            <li>Creator: {ch.readyCreator ? <span className="text-green-400">Ready</span> : 'Waiting'}</li>
            <li>Opponent: {ch.readyOpponent ? <span className="text-green-400">Ready</span> : 'Waiting'}</li>
          </ul>
          <div className="mt-3 text-xs text-zinc-500">Pot: {ch.stake * 2}</div>
          <div className="mt-2"><StakeChip label={`${ch.stake} at risk`} tone="risk" /></div>
        </aside>
      </div>
    </Shell>
  );
}

function Connect4Board({ board, disabled, onMove }: { board: number[]; disabled: boolean; onMove: (col: number) => void }) {
  return (
    <div className="inline-grid grid-cols-7 gap-2 rounded-2xl bg-blue-950 p-3 border border-blue-800">
      {Array.from({ length: 42 }, (_, i) => {
        const row = 5 - Math.floor(i / 7);
        const col = i % 7;
        const v = board[row * 7 + col] ?? 0;
        return (
          <button
            key={i}
            onClick={() => onMove(col)}
            disabled={disabled || v !== 0}
            className={`w-10 h-10 md:w-12 md:h-12 rounded-full border ${v === 1 ? 'bg-red-500 border-red-300' : v === 2 ? 'bg-yellow-300 border-yellow-100' : 'bg-zinc-950 border-blue-700 hover:bg-zinc-800'}`}
          />
        );
      })}
    </div>
  );
}

// ── Result ────────────────────────────────────────────────────────────────────

function ResultView({ ch, role, onBack }: { ch: Challenge; role: string; onBack: () => void }) {
  const yourUid = role === 'creator' ? ch.creatorUid : ch.opponentUid;
  const youWon = ch.winnerUid === yourUid;
  const snap = ch.settlementSnapshot;

  const headline = (() => {
    if (ch.status === 'CREATOR_REFUNDED') return 'Stake reclaimed';
    if ((ch as any).status === 'BOTH_REFUNDED') return 'No-show — both stakes refunded';
    if (ch.resultType === 'DRAW') return 'Draw — both refunded';
    if (ch.resultType === 'FORFEIT') return youWon ? 'You win by forfeit' : 'Opponent wins by forfeit';
    return youWon ? 'You win 🏆' : 'Opponent wins';
  })();

  const tone: 'won' | 'safe' = youWon ? 'won' : 'safe';
  const chip = (() => {
    if (ch.status === 'CREATOR_REFUNDED' || (ch as any).status === 'BOTH_REFUNDED' || ch.resultType === 'DRAW') return 'Refunded';
    return youWon ? `+${snap?.winnerAmount ?? 0}` : 'Stake lost';
  })();

  return (
    <Shell showBack onBack={onBack}>
      <div className="max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">{headline}</h1>
          <StakeChip label={chip} tone={chip === 'Stake lost' ? 'risk' : tone} />
        </div>
        {snap && (
          <div className="space-y-2 text-sm text-zinc-300">
            <div>Pot: {snap.pot} coins</div>
            {snap.winnerAmount > 0 && snap.winnerUid && <div>Winner received: {snap.winnerAmount} coins</div>}
            {snap.developerAmount > 0 && <div className="text-zinc-500">Developer fee: {snap.developerAmount}</div>}
            {snap.protocolAmount > 0 && <div className="text-zinc-500">Protocol fee: {snap.protocolAmount}</div>}
            <div className="text-xs text-zinc-500 mt-3 font-mono">TX: {ch.settlementTxId}</div>
          </div>
        )}
        <button onClick={onBack} className="mt-5 px-4 py-2 rounded-lg bg-white text-black font-semibold">Back to Arcade</button>
      </div>
    </Shell>
  );
}
