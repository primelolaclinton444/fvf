'use client';
import Link from 'next/link';

export function GameCard({ title, desc, badge, href }: { title: string; desc: string; badge?: string; href: string }) {
  return (
    <Link href={href} className="text-left block w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-5 hover:bg-zinc-900 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xl font-bold">{title}</div>
        {badge && <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400 text-black font-bold">{badge}</span>}
      </div>
      <div className="text-sm text-zinc-400 mb-4">{desc}</div>
      <div className="text-sm text-black font-semibold inline-block bg-white px-3 py-1 rounded-lg">Open</div>
    </Link>
  );
}
