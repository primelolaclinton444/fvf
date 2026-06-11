'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import { Shell } from '@/components/ui/Shell';
import { getChallenge, acceptChallenge, hydrateChallengeFromInvite } from '@/services/challenge.service';
import { gameTitle, formatSeconds } from '@/lib/format';
import type { Challenge } from '@/types/challenge';

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const params = useSearchParams();
  const { authed, uid } = useAuth();
  const { balance, refresh } = useWallet();
  const router = useRouter();
  const [ch, setCh] = useState<Challenge | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const invite = params.get('invite');
    if (invite) hydrateChallengeFromInvite(invite);
    setCh(getChallenge(code) ?? null);
  }, [code, params]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!ch) {
    return (
      <Shell showBack onBack={() => router.push('/arcade')}>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 max-w-xl">
          <h2 className="text-xl font-bold mb-2">Challenge Not Found</h2>
          <p className="text-sm text-zinc-400">This link may be incomplete. Ask the sender to share the full invite link.</p>
        </div>
      </Shell>
    );
  }

  const onAccept = () => {
    setErr(null);

    if (!authed) {
      /*
        FIX BUG 2: redirect after auth goes straight to the play page as opponent,
        NOT back to the join page (which would show "already accepted" or loop).
        We also preserve the invite param so hydration still works on the play page
        if the opponent lands there on a fresh device.
      */
      const invite = params.get('invite');
      const playUrl = `/challenge/play/${ch.code}?role=opponent${invite ? `&invite=${encodeURIComponent(invite)}` : ''}`;
      router.push(`/auth?redirect=${encodeURIComponent(playUrl)}`);
      return;
    }

    if (ch.stake > balance) { setErr(`Insufficient balance — you have ${balance} coins. Top up first.`); return; }

    try {
      acceptChallenge({ code: ch.code, uid });
      refresh();
      // FIX BUG 2: navigate using ch.code from the hydrated challenge, not from params
      router.push(`/challenge/play/${ch.code}?role=opponent`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error');
    }
  };

  const expired = now > ch.expiresAt;
  const alreadyFunded = ch.status !== 'AWAITING_OPPONENT';
  const pot = ch.stake * 2;
  const winnerAmount = Math.floor(pot * (100 - ch.feeStructure.developerFeePct - ch.feeStructure.protocolFeePct) / 100);

  return (
    <Shell showBack onBack={() => router.push('/arcade')}>
      <div className="max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="text-xs uppercase text-yellow-400 mb-2">Challenge Invitation</div>
        <h1 className="text-3xl font-bold mb-1">{gameTitle(ch.gameType)}</h1>
        <div className="text-sm text-zinc-400 mb-6">Code: <span className="font-mono">{ch.code}</span></div>

        {ch.creatorUid && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
            <div className="text-sm text-zinc-400">
              <span className="font-mono text-white">{ch.creatorUid.slice(0, 8)}…</span> has already locked
            </div>
            <div className="text-3xl font-bold text-green-400 mt-1">{ch.stake} coins</div>
          </div>
        )}

        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
          <div className="text-sm text-zinc-400">To accept, lock</div>
          <div className="text-3xl font-bold mt-1">{ch.stake} coins</div>
          <div className="text-xs text-zinc-500 mt-2">
            Winner receives <span className="text-white font-semibold">{winnerAmount} coins</span>
            <span className="text-zinc-500"> after {ch.feeStructure.developerFeePct + ch.feeStructure.protocolFeePct}% fee</span>
          </div>
        </div>

        {!expired && !alreadyFunded && (
          <div className="text-xs text-zinc-500 mb-4">
            Expires in <span className="font-mono text-yellow-300">{formatSeconds(ch.expiresAt - now)}</span>
          </div>
        )}

        {expired && <div className="text-sm text-red-400 mb-4">This challenge has expired.</div>}
        {alreadyFunded && !expired && <div className="text-sm text-yellow-400 mb-4">This challenge has already been accepted.</div>}

        {!expired && !alreadyFunded && (
          <button onClick={onAccept} className="w-full px-4 py-3 rounded-lg bg-white text-black font-semibold">
            Lock {ch.stake} coins to Accept
          </button>
        )}

        {err && <div className="text-sm text-red-400 mt-3">{err}</div>}
      </div>
    </Shell>
  );
}
