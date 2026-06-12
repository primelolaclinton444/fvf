'use client';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import { Shell } from '@/components/ui/Shell';
import { GameCard } from '@/components/ui/GameCard';
import { listChallenges, requestAdjudication } from '@/services/challenge.service';
import { subscribe } from '@/lib/realtime';
import type { Challenge } from '@/types/challenge';

const TERMINAL = new Set([
  'SETTLED',
  'CREATOR_REFUNDED',
  'PRESENT_PLAYER_PAID',
  'BOTH_REFUNDED',
  'EXPIRED',
]);

function action(ch: Challenge, uid: string, now: number): { label: string; tone: 'urgent' | 'wait' | 'go' } {
  const isCreator = ch.creatorUid === uid;
  switch (ch.status) {
    case 'AWAITING_OPPONENT':
      return now > ch.expiresAt
        ? { label: 'Expired — reclaim stake', tone: 'urgent' }
        : { label: 'Waiting for opponent', tone: 'wait' };
    case 'FULLY_FUNDED':
    case 'JOIN_WINDOW_STARTED': {
      const youIn = isCreator ? ch.creatorJoined : ch.opponentJoined;
      return youIn
        ? { label: 'Waiting for opponent to enter', tone: 'wait' }
        : { label: 'Enter match now', tone: 'urgent' };
    }
    case 'MATCH_ACTIVE':
      if (ch.gameType === 'CONNECT4') {
        if (ch.phase === 'IN_PROGRESS') {
          return {
            label: ch.currentTurnUid === uid ? 'Your turn' : "Opponent's turn",
            tone: ch.currentTurnUid === uid ? 'urgent' : 'wait',
          };
        }
        return { label: 'Ready up', tone: 'urgent' };
      } else {
        const youDone = isCreator ? ch.creatorResult : ch.opponentResult;
        return youDone
          ? { label: 'Waiting for opponent', tone: 'wait' }
          : { label: 'Play your run', tone: 'urgent' };
      }
    default:
      return { label: 'Resume', tone: 'go' };
  }
}

export default function ArcadePage() {
  const { uid } = useAuth();
  const { refresh } = useWallet();
  const [code, setCode] = useState('');
  const [active, setActive] = useState<Challenge[]>([]);
  const [now, setNow] = useState(Date.now());

  // Sweep + list. The server cron handles deadlines unconditionally, but firing
  // adjudicate for visibly-lapsed items shaves the wait for whoever's looking.
  const reload = useCallback(async () => {
    if (!uid) { setActive([]); return; }
    const mine = await listChallenges(uid);
    const t = Date.now();
    await Promise.all(
      mine
        .filter(c => !c.settled && !TERMINAL.has(c.status) && (c.expiresAt < t || (c.joinDeadlineAt && c.joinDeadlineAt < t) || (c.matchDeadlineAt && c.matchDeadlineAt < t)))
        .map(c => requestAdjudication(c.code).catch(() => {})),
    );
    const fresh = await listChallenges(uid);
    setActive(fresh.filter(c => !TERMINAL.has(c.status)));
    await refresh();
  }, [uid, refresh]);

  useEffect(() => { void reload(); }, [reload]);

  // Live: any challenge change in the DB pulls a fresh list.
  useEffect(() => {
    const unsub = subscribe('challenge', () => { void reload(); });
    return unsub;
  }, [reload]);

  // Keep relative timers fresh; light cadence since the DB drives state now.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const onJoin = () => {
    if (!code.trim()) return;
    const trimmed = code.trim();
    try {
      const u = new URL(trimmed);
      const pathSegments = u.pathname.split('/').filter(Boolean);
      const codeFromPath =
        pathSegments.length >= 3 && pathSegments[0] === 'challenge' && pathSegments[1] === 'join'
          ? pathSegments[2]
          : null;
      if (codeFromPath) {
        window.location.href = `/challenge/join/${codeFromPath.toUpperCase()}`;
        return;
      }
    } catch { /* not a URL — fall through */ }
    window.location.href = `/challenge/join/${trimmed.toUpperCase()}`;
  };

  const toneClass: Record<string, string> = {
    urgent: 'text-green-300 border-green-500/40 bg-green-500/10',
    wait:   'text-yellow-300/90 border-yellow-500/30 bg-yellow-500/5',
    go:     'text-zinc-300 border-zinc-700 bg-zinc-900',
  };

  return (
    <Shell>
      <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-6">Arcade</h1>

      {active.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase text-zinc-400 mb-3">Your active challenges</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.map(ch => {
              const a = action(ch, uid, now);
              return (
                <Link
                  key={ch.code}
                  href={`/challenge/play/${ch.code}?role=${ch.creatorUid === uid ? 'creator' : 'opponent'}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 hover:bg-zinc-900 relative"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-zinc-500">{ch.status}</div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${toneClass[a.tone]}`}>{a.label}</span>
                  </div>
                  <div className="text-lg font-mono font-bold">{ch.code}</div>
                  <div className="text-sm text-zinc-400">{ch.gameType} · {ch.stake} coins</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 max-w-2xl mb-8">
        <h3 className="text-lg font-bold mb-2">Join a Challenge</h3>
        <div className="flex items-center gap-2">
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Paste full invite link or code"
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 outline-none"
          />
          <button onClick={onJoin} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Join</button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">Paste the invite link or just the code.</p>
      </div>

      <h2 className="text-sm uppercase text-zinc-400 mb-3">Create a challenge</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <GameCard title="5 Numbers Scout" desc="Find any five targets fast." href="/challenge/create/SCOUT" />
        <GameCard title="25 Down" desc="Tap 25 → 1 in order." href="/challenge/create/DOWN" />
        <GameCard title="25 Up" desc="Tap 1 → 25 in order." href="/challenge/create/UP" />
        <GameCard title="Connect 4" desc="Live game with turn timers." badge="SYNC" href="/challenge/create/CONNECT4" />
      </div>
    </Shell>
  );
}
