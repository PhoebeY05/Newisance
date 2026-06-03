import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../context/AuthContext'
import TierBadge from '../components/TierBadge'
import type { LeaderboardEntry, LeaderboardScope } from '../types/dashboard'

/**
 * Leaderboard — "Top Newisance Defenders" (Figma node 39:218), wired to the
 * live `/api/dashboard/leaderboard` endpoint (Redis sorted sets). Podium of the
 * top 3, a ranked table with tier + score, the current user's row highlighted,
 * and a weekly/all-time toggle. Scores come from games (Battle + Timed).
 */
export default function Leaderboard() {
  const apiFetch = useApi()
  const { user } = useAuth()
  const [scope, setScope] = useState<LeaderboardScope>('weekly')
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)

  useEffect(() => {
    let active = true
    setEntries(null)
    void (async () => {
      try {
        const res = await apiFetch(`/api/dashboard/leaderboard?scope=${scope}&limit=50`)
        if (active) setEntries((await res.json()) as LeaderboardEntry[])
      } catch {
        if (active) setEntries([])
      }
    })()
    return () => {
      active = false
    }
  }, [apiFetch, scope])

  const podium = entries ? entries.slice(0, 3) : []

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
        {(
          [
            ['weekly', 'This Week'],
            ['alltime', 'All Time'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setScope(value)}
            aria-pressed={scope === value}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              scope === value ? 'bg-brand text-white' : 'bg-surface text-ink-soft hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {entries === null ? (
        <p className="mt-12 text-center text-ink-soft">Loading leaderboard…</p>
      ) : entries.length === 0 ? (
        <p className="mt-12 rounded-3xl border border-black/5 bg-surface p-8 text-center text-ink-soft">
          No rankings yet. Play a{' '}
          <a href="/learn" className="font-semibold text-brand hover:underline">
            game
          </a>{' '}
          to get on the board — every correct answer earns points.
        </p>
      ) : (
        <>
          {/* Podium (top 3) */}
          <div className="mt-10 grid items-end gap-4 sm:grid-cols-3">
            {podium.map((p) => (
              <div
                key={p.user_id}
                className={`flex flex-col items-center rounded-3xl bg-card p-6 text-white shadow-sm ${
                  p.rank === 1
                    ? 'sm:order-2 sm:-mt-6'
                    : p.rank === 2
                      ? 'sm:order-1 sm:mt-6'
                      : 'sm:order-3 sm:mt-6'
                }`}
              >
                {p.rank === 1 && <span className="text-2xl">👑</span>}
                <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary/20 text-lg font-extrabold text-secondary">
                  {initials(p.username)}
                </span>
                <span
                  className={`mt-2 grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold ${podiumBadge[p.rank] ?? 'bg-white/10'}`}
                >
                  {p.rank}
                </span>
                <p className="mt-2 max-w-full truncate font-bold">{p.username}</p>
                <TierBadge tier={p.tier} className="mt-1" />
                <p className="mt-1 font-display text-2xl font-extrabold text-secondary">
                  {Math.round(p.score)}
                </p>
              </div>
            ))}
          </div>

          {/* Ranked table */}
          <section className="mt-8 overflow-hidden rounded-3xl border border-black/5 bg-surface shadow-sm">
            <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem] items-center gap-3 border-b border-black/5 px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-soft sm:grid-cols-[3rem_1fr_7rem_6rem]">
              <span>Rank</span>
              <span>User</span>
              <span className="hidden text-right sm:block">Credibility</span>
              <span className="text-right">Score</span>
            </div>

            {entries.map((e) => {
              const you = user?.id === e.user_id
              return (
                <div
                  key={e.user_id}
                  className={`grid grid-cols-[2.5rem_1fr_5rem_5rem] items-center gap-3 border-b border-black/5 px-5 py-4 text-sm last:border-0 sm:grid-cols-[3rem_1fr_7rem_6rem] ${
                    you ? 'bg-brand/5' : ''
                  }`}
                >
                  <span className="font-display text-lg font-extrabold text-ink-faint">
                    {medals[e.rank] ?? e.rank}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 font-semibold text-card">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary/15 text-xs font-bold text-secondary">
                      {initials(e.username)}
                    </span>
                    <span className="truncate">{e.username}</span>
                    <TierBadge tier={e.tier} />
                    {you && (
                      <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                        YOU
                      </span>
                    )}
                  </span>
                  <span className="hidden text-right font-medium text-ink-soft sm:block">
                    {Math.round(e.credibility_score)}
                  </span>
                  <span className="text-right font-bold text-card">{Math.round(e.score)}</span>
                </div>
              )
            })}
          </section>
        </>
      )}

      {/* Weekly rewards */}
      <section className="mt-8 rounded-3xl bg-card p-8 text-white shadow-sm">
        <h2 className="font-display text-xl font-extrabold">Weekly Rewards</h2>
        <p className="mt-1 text-sm text-white/70">
          Each Monday the top 3 receive a voucher from our partner brands:
        </p>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {['Grab', 'Shopee', 'Starbucks', 'FoodPanda'].map((b) => (
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

const podiumBadge: Record<number, string> = {
  1: 'bg-highlight text-ink',
  2: 'bg-ink-faint text-white',
  3: 'bg-risk-med text-white',
}

const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function initials(name: string): string {
  const parts = name.replace(/[_-]/g, ' ').trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
