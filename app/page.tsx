import Link from 'next/link';
import { GameCard } from '@/components/ui/GameCard';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-4 py-6 border-b border-zinc-900">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="text-2xl md:text-3xl font-extrabold tracking-tight">Play4Stakes</div>
          <Link href="/auth" className="px-3 py-1.5 rounded-lg border border-zinc-800 text-sm">Log in / Sign up</Link>
        </div>
      </header>
      <main className="px-4 py-10">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-extrabold mb-3">Whose the better player?? - Stake your skill. Win the pot. Turn Play into PAYDAY</h1>
          <p className="text-zinc-300 mb-6">Lock your stake. Send the link. Winner takes the pot.</p>
          <div className="flex gap-3 mb-10">
            <Link href="/arcade" className="px-5 py-3 rounded-lg bg-white text-black font-semibold">Enter Arcade</Link>
            <Link href="/auth" className="px-5 py-3 rounded-lg border border-zinc-800">Log in / Sign up</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <GameCard title="5 Numbers Scout" desc="Find any five targets fast." href="/arcade" />
            <GameCard title="25 Down" desc="Tap 25 → 1 in order." href="/arcade" />
            <GameCard title="25 Up" desc="Tap 1 → 25 in order." href="/arcade" />
            <GameCard title="Connect 4" desc="Live synchronous board game." badge="SYNC" href="/arcade" />
          </div>
        </div>
      </main>
    </div>
  );
}
