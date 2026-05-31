import { useState } from 'react'

/**
 * Leaderboard — "Top Newisance Defenders" (Figma node 39:218). A podium of
 * the top 3, a ranked table with credibility/accuracy/reward, a highlighted
 * "You" row, and a Weekly Rewards panel. Data is hardcoded mock matching the
 * Figma design; the timeframe tabs are presentational.
 */
export default function Leaderboard() {
  const [range, setRange] = useState<'All Time' | 'This Week' | 'This Month'>('All Time')

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold text-card sm:text-5xl">
          Top Newisance Defenders
        </h1>
        <p className="mt-3 text-lg text-ink-soft">
          The most accurate and trusted fact-checkers in our community
        </p>
      </header>

      {/* Timeframe tabs */}
      <div className="mt-8 flex justify-center gap-2">
        {(['All Time', 'This Week', 'This Month'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              range === r ? 'bg-brand text-white' : 'bg-surface text-ink-soft hover:text-ink'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Podium */}
      <div className="mt-10 grid items-end gap-4 sm:grid-cols-3">
        {podium.map((p) => (
          <div
            key={p.rank}
            className={`flex flex-col items-center rounded-3xl bg-card p-6 text-white shadow-sm ${
              p.rank === 1 ? 'sm:order-2 sm:-mt-6' : p.rank === 2 ? 'sm:order-1 sm:mt-6' : 'sm:order-3 sm:mt-6'
            }`}
          >
            {p.rank === 1 && <span className="text-2xl">👑</span>}
            <span className="text-5xl">{p.emoji}</span>
            <span
              className={`mt-2 grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold ${podiumBadge[p.rank]}`}
            >
              {p.rank}
            </span>
            <p className="mt-2 font-bold">{p.name}</p>
            <p className="font-display text-2xl font-extrabold text-secondary">{p.score}</p>
          </div>
        ))}
      </div>

      {/* Ranked table */}
      <section className="mt-8 overflow-hidden rounded-3xl border border-black/5 bg-surface shadow-sm">
        <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem] items-center gap-3 border-b border-black/5 px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-soft sm:grid-cols-[3rem_1fr_6rem_6rem_8rem]">
          <span>Rank</span>
          <span>User</span>
          <span className="text-right">Credibility</span>
          <span className="text-right">Accuracy</span>
          <span className="hidden text-right sm:block">Reward</span>
        </div>

        {rows.map((r) => (
          <div
            key={r.rank}
            className={`grid grid-cols-[2.5rem_1fr_5rem_5rem] items-center gap-3 border-b border-black/5 px-5 py-4 text-sm last:border-0 sm:grid-cols-[3rem_1fr_6rem_6rem_8rem] ${
              r.you ? 'bg-brand/5' : ''
            }`}
          >
            <span className="font-display text-lg font-extrabold text-ink-faint">{r.medal ?? r.rank}</span>
            <span className="flex items-center gap-2 font-semibold text-card">
              <span className="text-lg">{r.emoji}</span>
              {r.name}
              {r.you && (
                <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                  YOU
                </span>
              )}
            </span>
            <span className="text-right font-bold text-card">{r.credibility}</span>
            <span className="text-right font-medium text-ink-soft">{r.accuracy}</span>
            <span className="hidden text-right font-semibold text-secondary sm:block">
              {r.reward ?? '—'}
            </span>
          </div>
        ))}
      </section>

      {/* Weekly rewards */}
      <section className="mt-8 rounded-3xl bg-card p-8 text-white shadow-sm">
        <h2 className="font-display text-xl font-extrabold">Weekly Rewards</h2>
        <p className="mt-1 text-sm text-white/70">
          Top performers receive vouchers from our partner brands:
        </p>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {['Brand A', 'Brand B', 'Brand C', 'Brand D'].map((b) => (
            <div
              key={b}
              className="grid h-20 place-items-center rounded-2xl bg-white/5 font-semibold text-white/70 ring-1 ring-white/10"
            >
              {b}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

const podium = [
  { rank: 2, emoji: '🐝', name: 'CyberBee', score: 941 },
  { rank: 1, emoji: '🦊', name: 'ShieldFox', score: 982 },
  { rank: 3, emoji: '🥷', name: 'FactNinja', score: 899 },
]

const podiumBadge: Record<number, string> = {
  1: 'bg-highlight text-ink',
  2: 'bg-ink-faint text-white',
  3: 'bg-risk-med text-white',
}

interface Row {
  rank: number
  medal?: string
  emoji: string
  name: string
  credibility: number
  accuracy: string
  reward?: string
  you?: boolean
}

const rows: Row[] = [
  { rank: 1, medal: '🥇', emoji: '🦊', name: 'ShieldFox', credibility: 982, accuracy: '94%', reward: '$100 voucher' },
  { rank: 2, medal: '🥈', emoji: '🐝', name: 'CyberBee', credibility: 941, accuracy: '91%', reward: '$50 voucher' },
  { rank: 3, medal: '🥉', emoji: '🥷', name: 'FactNinja', credibility: 899, accuracy: '89%', reward: '$50 voucher' },
  { rank: 4, emoji: '🔍', name: 'TruthSeeker', credibility: 845, accuracy: '87%', reward: '$20 voucher' },
  { rank: 5, emoji: '🛡️', name: 'InfoGuard', credibility: 823, accuracy: '86%', reward: '$20 voucher' },
  { rank: 12, emoji: '👤', name: 'You', credibility: 782, accuracy: '84%', you: true },
]
