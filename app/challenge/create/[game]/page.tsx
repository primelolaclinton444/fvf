'use client';
import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import { Shell } from '@/components/ui/Shell';
import { CopyableCode } from '@/components/ui/CopyableCode';
import { createChallenge } from '@/services/challenge.service';
import { encodeChallengeInvite } from '@/lib/invite';
import { gameTitle } from '@/lib/format';
import type { GameType } from '@/types/challenge';

export default function CreatePage() {
  const { game } = useParams<{ game: string }>();
  const gameType = game?.toUpperCase() as GameType;
  const { authed, uid } = useAuth();
  const { balance, refresh } = useWallet();
  const router = useRouter();
  const [stake, setStake] = useState(50);
  const [err, setErr] = useState<string | null>(null);
  // FIX BUG 1: store the invite string in state so it survives navigation to play page
  const [created, setCreated] = useState<{ code: string; invite: string } | null>(null);

  const onCreate = () => {
    setErr(null);
    if (!authed) { router.push(`/auth?redirect=/challenge/create/${game}`); return; }
    if (stake > balance) { setErr(`Insufficient balance — you have ${balance} coins.`); return; }
    try {
      const ch = createChallenge({ uid, gameType, stake });
      const invite = encodeChallengeInvite(ch);
      setCreated({ code: ch.code, invite });
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error');
    }
  };

  const shareUrl = (code: string, invite: string) => {
    if (typeof window === 'undefined') return '';
    const u = new URL(window.location.href);
    u.pathname = `/challenge/join/${code}`;
    u.search = `?invite=${encodeURIComponent(invite)}`;
    return u.toString();
  };

  return (
    <Shell showBack onBack={() => router.push('/arcade')}>
      <h1 className="text-2xl font-bold mb-1">Create {gameTitle(gameType)} Challenge</h1>
      <p className="text-sm text-zinc-400 mb-6">Lock your stake to create the challenge. Your opponent must match it to accept.</p>

      {!created ? (
        <div className="max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <label className="text-xs text-zinc-400">Stake (coins)</label>
          <input type="number" value={stake} onChange={e => setStake(parseInt(e.target.value || '0', 10))} className="w-full mt-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800" />
          <div className="text-xs text-zinc-500 mt-1">Your balance: {balance} coins</div>
          <button onClick={onCreate} className="mt-4 w-full px-4 py-2 rounded-lg bg-white text-black font-semibold">Lock Stake & Create</button>
          {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
        </div>
      ) : (
        <div className="max-w-2xl rounded-2xl border border-green-500/30 bg-green-500/5 p-5">
          <div className="text-sm text-green-300 mb-2">✓ Challenge created — stake locked</div>
          <div className="text-2xl font-mono font-bold mb-4">{created.code}</div>
          <p className="text-sm text-zinc-300 mb-4">Send this link to your opponent. They'll see your stake is already locked.</p>
          <CopyableCode label="Invite link" value={shareUrl(created.code, created.invite)} />
          <div className="flex gap-2 mt-4">
            {/*
              FIX BUG 1: pass invite as a query param so PlayPage / AwaitingOpponentView
              can regenerate the share link without the creator having to come back here.
            */}
            <button
              onClick={() => router.push(`/challenge/play/${created.code}?role=creator&invite=${encodeURIComponent(created.invite)}`)}
              className="px-4 py-2 rounded-lg bg-white text-black font-semibold"
            >
              Enter Game Room
            </button>
            <button onClick={() => router.push('/arcade')} className="px-4 py-2 rounded-lg border border-zinc-800">Back to Arcade</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
