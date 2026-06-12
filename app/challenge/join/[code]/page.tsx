'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import { Shell } from '@/components/ui/Shell';
import { getChallenge, acceptChallenge } from '@/services/challenge.service';
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
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Phase 2: the challenge lives in the DB, so we fetch by code. The legacy
  // `?invite=` query param is ignored — kept for old shared links.
  useEffect(() => {
    let alive = true;
    void getChallenge(code).then(c => { if (alive) setCh(c ?? null); });
    return () => { alive = false; };
  }, [code]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!ch) {
    return (
      <Shell showBack onBack={() => router.push('/arcade')}>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 max-w-xl">
          <h2 className="text-xl font-bold mb-2">Challenge Not Found</h2>
          <p className="text-sm text-zinc-400">
            The code may be wrong, or the challenge may have expired. Ask the sender to share a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  const onAccept = async () => {
    setErr(null);

    if (!authed) {
      const invite = params.get('invite');
      const playUrl = `/challenge/play/${ch.code}?role=opponent${invite ? `&invite=${encodeURIComponent(invite)}` : ''}`;
      router.push(`/auth?redirect=${encodeURIComponent(playUrl)}`);
      return;
    }

    if (ch.stake > balance) {
      setErr(`Insufficient balance — you have ${balance} coins. Top up first.`);
      return;
    }

    setBusy(true);
    try {
      await acceptChallenge({ code: ch.code, uid });
      await refresh();
      router.push(`/challenge/play/${ch.code}?role=opponent`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/_/g, ' ') : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const isExpired = now > ch.expiresAt;
  const isSelf = uid && ch.creatorUid === uid;

  return (
    <Shell showBack onBack={() => router.push('/arcade')}>
      <div className="max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="text-xs uppercase text-zinc-400 mb-1">{gameTitle(ch.gameType)} Challenge</div>
        <div className="text-3xl font-mono font-bold mb-4">{ch.code}</div>
        <div className="text-sm text-zinc-300 mb-4">Stake: <span className="font-bold text-white">{ch.stake} coins</span></div>
        {!isExpired && (
          <div className="text-xs text-zinc-500 mb-4">Expires in {formatSeconds(ch.expiresAt - now)}</div>
        )}

        {isSelf ? (
          <div className="text-sm text-yellow-400">This is your challenge. Wait for someone else to accept.</div>
        ) : isExpired ? (
          <div className="text-sm text-red-400">This challenge has expired.</div>
        ) : ch.status !== 'AWAITING_OPPONENT' ? (
          <button
            onClick={() => router.push(`/challenge/play/${ch.code}`)}
            className="px-4 py-2 rounded-lg bg-white text-black font-semibold"
          >
            Go to match
          </button>
        ) : (
          <button
            onClick={onAccept}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-white text-black font-semibold disabled:opacity-60"
          >
            {busy ? 'Locking stake…' : `Accept & lock ${ch.stake} coins`}
          </button>
        )}
        {err && <div className="text-sm text-red-400 mt-3">{err}</div>}
      </div>
    </Shell>
  );
}
