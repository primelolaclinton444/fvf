'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import { Shell } from '@/components/ui/Shell';
import { useGameTimer } from '@/hooks/useGameTimer';
import { getChallenge, joinMatch } from '@/services/challenge.service';
import { submitAsyncResult, submitConnect4Move, submitConnect4Ready, checkAndAdjudicate, type AsyncMoveRecord } from '@/services/game.service';
import { gameGridFromSeed, prngFromSeed, seededPickUnique } from '@/lib/prng';
import { gameTitle, formatSeconds } from '@/lib/format';
import { connect4Policy } from '@/config/connect4/policy';
import type { Challenge } from '@/types/challenge';
import type { Connect4MatchState } from '@/types/connect4';
import { readMatch } from '@/store/connect4.store';

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const params = useSearchParams();
  const role = (params.get('role') as 'creator' | 'opponent') || 'creator';
  const { uid } = useAuth();
  const { refresh } = useWallet();
  const router = useRouter();
  const [ch, setCh] = useState<Challenge | null>(null);
  const [now, setNow] = useState(Date.now());

  const sync = () => {
    const latest = getChallenge(code);
    if (latest) setCh({ ...latest });
  };

  useEffect(() => {
    const latest = getChallenge(code);
    if (latest) {
      // Auto-join when entering the play page if not yet joined
      if (latest.status === 'FULLY_FUNDED' || latest.status === 'JOIN_WINDOW_STARTED') {
        try { joinMatch({ code, uid }); } catch {}
      }
      sync();
    }
  }, [code, uid]);

  useEffect(() => {
    const id = setInterval(() => {
      checkAndAdjudicate(code, Date.now());
      sync();
      setNow(Date.now());
      refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [code, refresh]);

  if (!ch) {
    return (
      <Shell showBack onBack={() => router.push('/arcade')}>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 max-w-xl">
          <h2 className="text-xl font-bold mb-2">Challenge Not Found</h2>
        </div>
      </Shell>
    );
  }

  // Terminal states — show result
  if (ch.status === 'SETTLED' || ch.status === 'CREATOR_REFUNDED' || ch.status === 'PRESENT_PLAYER_PAID' || ch.status === 'FORFEIT') {
    return <ResultView ch={ch} role={role} onBack={() => router.push('/arcade')} />;
  }

  // Pre-match states
  if (ch.status === 'AWAITING_OPPONENT') {
    return <AwaitingOpponentView ch={ch} role={role} now={now} onBack={() => router.push('/arcade')} />;
  }

  if (ch.status === 'FULLY_FUNDED' || ch.status === 'JOIN_WINDOW_STARTED') {
    return <JoinWindowView ch={ch} role={role} now={now} onBack={() => router.push('/arcade')} />;
  }

  // Active match
  if (ch.status === 'MATCH_ACTIVE') {
    if (ch.gameType === 'CONNECT4') return <Connect4Play ch={ch} role={role} now={now} onSync={sync} onBack={() => router.push('/arcade')} />;
    return <AsyncPlay ch={ch} role={role} onSync={sync} onBack={() => router.push('/arcade')} />;
  }

  return null;
}

// ── Awaiting opponent ────────────────────────────────────────────────────────

function AwaitingOpponentView({ ch, role, now, onBack }: { ch: Challenge; role: string; now: number; onBack: () => void }) {
  return (
    <Shell showBack onBack={onBack}>
      <div className="max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <h1 className="text-2xl font-bold mb-2">Waiting for opponent</h1>
        <p className="text-sm text-zinc-400 mb-4">Your stake of {ch.stake} coins is locked. Share the invite link below.</p>
        <div className="text-xs text-zinc-500">Code: <span className="font-mono text-white">{ch.code}</span></div>
        <div className="text-xs text-zinc-500 mt-1">Expires in {formatSeconds(ch.expiresAt - now)}</div>
      </div>
    </Shell>
  );
}

// ── Join window (3 min for both players to enter) ────────────────────────────

function JoinWindowView({ ch, role, now, onBack }: { ch: Challenge; role: string; now: number; onBack: () => void }) {
  const youJoined = role === 'creator' ? ch.creatorJoined : ch.opponentJoined;
  const otherJoined = role === 'creator' ? ch.opponentJoined : ch.creatorJoined;
  const remaining = ch.joinDeadlineAt ? ch.joinDeadlineAt - now : 0;

  return (
    <Shell showBack onBack={onBack}>
      <div className="max-w-2xl rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-6">
        <div className="text-xs uppercase text-yellow-400 mb-2">Both stakes locked</div>
        <h1 className="text-2xl font-bold mb-2">Enter the arena</h1>
        <p className="text-sm text-zinc-300 mb-4">Both players have {formatSeconds(remaining)} to join. No-show forfeits the pot.</p>
        <div className="space-y-2 mb-4">
          <div className="text-sm">You: {youJoined ? <span className="text-green-400">Joined</span> : <span className="text-yellow-300">Joining…</span>}</div>
          <div className="text-sm">Opponent: {otherJoined ? <span className="text-green-400">Joined</span> : <span className="text-yellow-300">Waiting</span>}</div>
        </div>
      </div>
    </Shell>
  );
}

// ── Async play (Scout / Down / Up) ───────────────────────────────────────────

function AsyncPlay({ ch, role, onSync, onBack }: { ch: Challenge; role: 'creator' | 'opponent'; onSync: () => void; onBack: () => void }) {
  const { uid } = useAuth();
  const { refresh } = useWallet();
  const yourResult = role === 'creator' ? ch.creatorResult : ch.opponentResult;
  const [err, setErr] = useState<string | null>(null);

  const onDone = (moves: AsyncMoveRecord[]) => {
    try {
      submitAsyncResult({ code: ch.code, role, uid, moves });
      refresh();
      onSync();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error');
    }
  };

  return (
    <Shell showBack onBack={onBack}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="mb-4">
            <div className="text-sm text-zinc-400">Challenge</div>
            <div className="text-2xl font-mono font-bold">{ch.code}</div>
          </div>
          {yourResult ? (
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
              <div className="text-sm text-zinc-400">Your time</div>
              <div className="text-2xl font-mono font-bold">{(yourResult.finalMs / 1000).toFixed(6)}s</div>
              <div className="text-xs text-zinc-500 mt-2">Waiting for opponent…</div>
            </div>
          ) : (
            <>
              {ch.gameType === 'SCOUT' && <SeededScout seed={ch.seed} onDone={onDone} />}
              {ch.gameType === 'DOWN' && <SeededDown seed={ch.seed} onDone={onDone} />}
              {ch.gameType === 'UP' && <SeededUp seed={ch.seed} onDone={onDone} />}
            </>
          )}
          {err && <div className="text-sm text-red-400 mt-3">{err}</div>}
        </div>
        <aside className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-lg font-bold mb-2">Match</h3>
          <div className="text-sm text-zinc-400">Stake each: {ch.stake} · Pot {ch.stake * 2}</div>
          <div className="text-xs text-zinc-500 mt-2">Game: {gameTitle(ch.gameType)}</div>
        </aside>
      </div>
    </Shell>
  );
}

function SeededScout({ seed, onDone }: { seed: string; onDone: (moves: AsyncMoveRecord[]) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const targets = useMemo(() => { const rnd = prngFromSeed('targets-' + seed); return seededPickUnique(Array.from({ length: 25 }, (_, i) => i + 1), 5, rnd); }, [seed]);
  const { started, live, start } = useGameTimer();
  const [found, setFound] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const [moves] = useState<AsyncMoveRecord[]>([]);

  const click = (n: number) => {
    if (!started || done || !targets.includes(n) || found.includes(n)) return;
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
        {grid.map((num, idx) => <button key={idx} onClick={() => click(num)} disabled={found.includes(num) || done} className={`w-14 h-14 text-xl font-bold rounded-lg ${found.includes(num) ? 'bg-green-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}>{num}</button>)}
      </div>
    </div>
  );
}

function SeededDown({ seed, onDone }: { seed: string; onDone: (moves: AsyncMoveRecord[]) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const { started, live, start } = useGameTimer();
  const [next, setNext] = useState(25);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);
  const [moves] = useState<AsyncMoveRecord[]>([]);

  const click = (n: number) => {
    if (!started || done || n !== next) return;
    moves.push({ value: n, timestamp: performance.now() });
    const nf = new Set(found).add(n);
    setFound(nf);
    if (next === 1) { setDone(true); onDone([...moves]); }
    else setNext(v => v - 1);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}
        <div className="text-lg tabular-nums font-mono">Time: {live}s</div>
        <div className="text-sm text-zinc-400">Next: <span className="font-bold text-white">{done ? '-' : next}</span></div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {grid.map((num, idx) => <button key={idx} onClick={() => click(num)} disabled={found.has(num) || done} className={`w-14 h-14 text-xl font-bold rounded-lg ${found.has(num) ? 'bg-green-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}>{num}</button>)}
      </div>
    </div>
  );
}

function SeededUp({ seed, onDone }: { seed: string; onDone: (moves: AsyncMoveRecord[]) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const { started, live, start } = useGameTimer();
  const [next, setNext] = useState(1);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);
  const [moves] = useState<AsyncMoveRecord[]>([]);

  const click = (n: number) => {
    if (!started || done || n !== next) return;
    moves.push({ value: n, timestamp: performance.now() });
    const nf = new Set(found).add(n);
    setFound(nf);
    if (next === 25) { setDone(true); onDone([...moves]); }
    else setNext(v => v + 1);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}
        <div className="text-lg tabular-nums font-mono">Time: {live}s</div>
        <div className="text-sm text-zinc-400">Next: <span className="font-bold text-white">{done ? '-' : next}</span></div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {grid.map((num, idx) => <button key={idx} onClick={() => click(num)} disabled={found.has(num) || done} className={`w-14 h-14 text-xl font-bold rounded-lg ${found.has(num) ? 'bg-green-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}>{num}</button>)}
      </div>
    </div>
  );
}

// ── Connect 4 play ───────────────────────────────────────────────────────────

function Connect4Play({ ch, role, now, onSync, onBack }: { ch: Challenge; role: 'creator' | 'opponent'; now: number; onSync: () => void; onBack: () => void }) {
  const { uid } = useAuth();
  const [match, setMatch] = useState<Connect4MatchState | null>(() => readMatch(ch.code) ?? null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const m = readMatch(ch.code);
      if (m) setMatch({ ...m });
    }, 1000);
    return () => clearInterval(id);
  }, [ch.code]);

  if (!match) return null;

  const isMyTurn = ch.phase === 'IN_PROGRESS' && ch.currentTurnUid === uid;
  const deadline = ch.phase === 'WAITING_READY' ? ch.readyDeadlineAt : ch.turnDeadlineAt;
  const timer = deadline ? formatSeconds(deadline - now) : '--';
  const myReady = role === 'creator' ? ch.readyCreator : ch.readyOpponent;

  const onMove = (col: number) => {
    setErr(null);
    try {
      submitConnect4Move({ code: ch.code, uid, col });
      onSync();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error');
    }
  };

  const onReady = () => {
    setErr(null);
    try {
      submitConnect4Ready({ code: ch.code, uid, ready: !myReady });
      onSync();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error');
    }
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

// ── Result ──────────────────────────────────────────────────────────────────

function ResultView({ ch, role, onBack }: { ch: Challenge; role: string; onBack: () => void }) {
  const yourUid = role === 'creator' ? ch.creatorUid : ch.opponentUid;
  const youWon = ch.winnerUid === yourUid;
  const snap = ch.settlementSnapshot;

  const headline = (() => {
    if (ch.status === 'CREATOR_REFUNDED') return 'Stake reclaimed';
    if (ch.resultType === 'DRAW') return 'Draw — both refunded';
    if (ch.resultType === 'FORFEIT') return youWon ? 'You win by forfeit' : 'Opponent wins by forfeit';
    return youWon ? 'You win 🏆' : 'Opponent wins';
  })();

  return (
    <Shell showBack onBack={onBack}>
      <div className="max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <h1 className="text-3xl font-bold mb-4">{headline}</h1>
        {snap && (
          <div className="space-y-2 text-sm text-zinc-300">
            <div>Pot: {snap.pot} coins</div>
            {snap.winnerAmount > 0 && snap.winnerUid && (
              <div>Winner received: {snap.winnerAmount} coins</div>
            )}
            {snap.developerAmount > 0 && <div className="text-zinc-500">Developer fee: {snap.developerAmount}</div>}
            {snap.protocolAmount > 0 && <div className="text-zinc-500">Protocol fee: {snap.protocolAmount}</div>}
            <div className="text-xs text-zinc-500 mt-3 font-mono">TX: {ch.settlementTxId}</div>
          </div>
        )}
      </div>
    </Shell>
  );
}
