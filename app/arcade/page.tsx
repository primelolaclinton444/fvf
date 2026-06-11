'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Shell } from '@/components/ui/Shell';
import { GameCard } from '@/components/ui/GameCard';
import { listChallenges, hydrateChallengeFromInvite } from '@/services/challenge.service';
import type { Challenge } from '@/types/challenge';

export default function ArcadePage() {
  const { uid } = useAuth();
  const [code, setCode] = useState('');
  const [active, setActive] = useState<Challenge[]>([]);

  useEffect(() => {
    if (uid) {
      setActive(
        listChallenges(uid).filter(
          c =>
            c.status !== 'SETTLED' &&
            c.status !== 'CREATOR_REFUNDED' &&
            c.status !== 'PRESENT_PLAYER_PAID' &&
            // FIX BUG 7 (display): hide BOTH_REFUNDED from active list too
            (c as any).status !== 'BOTH_REFUNDED'
        )
      );
    }
  }, [uid]);

  const onJoin = () => {
    if (!code.trim()) return;
    const trimmed = code.trim();

    try {
      const u = new URL(trimmed);
      const invite = u.searchParams.get('invite');

      /*
        FIX BUG 6: the invite URL format is /challenge/join/<CODE>?invite=<...>
        The challenge code is in the PATHNAME (last segment), not in a query param
        called "code". The old code did u.searchParams.get('code') which always
        returned null, so hydrateChallengeFromInvite was never called from here
        and cross-device joins via the Arcade join box were silently broken.
      */
      const pathSegments = u.pathname.split('/').filter(Boolean);
      // e.g. ['challenge', 'join', 'ABCD1234']
      const codeFromPath =
        pathSegments.length >= 3 && pathSegments[0] === 'challenge' && pathSegments[1] === 'join'
          ? pathSegments[2]
          : null;

      if (codeFromPath && invite) {
        hydrateChallengeFromInvite(invite);
        window.location.href = `/challenge/join/${codeFromPath.toUpperCase()}?invite=${encodeURIComponent(invite)}`;
        return;
      }

      if (codeFromPath) {
        window.location.href = `/challenge/join/${codeFromPath.toUpperCase()}`;
        return;
      }

      // URL that doesn't match expected shape — fall through to bare-code path
    } catch {
      // Not a URL — treat as bare code below
    }

    // Bare code
    window.location.href = `/challenge/join/${trimmed.toUpperCase()}`;
  };

  return (
    <Shell>
      <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-6">Arcade</h1>

      {active.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase text-zinc-400 mb-3">Your active challenges</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.map(ch => (
              <Link
                key={ch.code}
                href={`/challenge/play/${ch.code}?role=${ch.creatorUid === uid ? 'creator' : 'opponent'}`}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 hover:bg-zinc-900"
              >
                <div className="text-xs text-zinc-500 mb-1">{ch.status}</div>
                <div className="text-lg font-mono font-bold">{ch.code}</div>
                <div className="text-sm text-zinc-400">{ch.gameType} · {ch.stake} coins</div>
              </Link>
            ))}
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
        <p className="text-xs text-zinc-500 mt-2">Paste the full invite link from your opponent — short codes only work on the same device.</p>
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
