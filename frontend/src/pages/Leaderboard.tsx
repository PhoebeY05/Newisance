import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import TierBadge from '../components/TierBadge'
import type { LeaderboardEntry, LeaderboardScope } from '../types/dashboard'

/**
 * Leaderboard — "Top Newisance Defenders" (Figma node 39:218), wired to the
 * live `/api/dashboard/leaderboard/stream` SSE endpoint (Redis sorted sets).
 * The board pushes a fresh ranking the instant a score lands — no polling.
 * Podium of the top 3, a ranked table with tier + score, the current user's row
 * highlighted, and a weekly/all-time toggle. Scores come from games (Battle +
 * Timed). The board is public, so a plain same-origin EventSource is all we need
 * (the "YOU" highlight comes from useAuth, not the API).
 */
export default function Leaderboard() {
  const { user } = useAuth()
  const [scope, setScope] = useState<LeaderboardScope>('weekly')
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)

  useEffect(() => {
    setEntries(null)
    const source = new EventSource(
      `/api/dashboard/leaderboard/stream?scope=${scope}&limit=50`,
    )
    source.onmessage = (event) => {
      try {
        setEntries(JSON.parse(event.data) as LeaderboardEntry[])
      } catch {
        // Ignore a malformed frame; the next push will replace it.
      }
    }
    source.onerror = () => {
      // EventSource reconnects on its own; only surface "empty" if we never got
      // a first frame, so a transient blip doesn't wipe a populated board.
      setEntries((prev) => (prev === null ? [] : prev))
    }
    return () => source.close()
  }, [scope])

  const podium = entries ? entries.slice(0, 3) : []

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="text-center">
        <h1 className="font-display text-2xl font-extrabold text-card sm:text-5xl">
          Top Newisance Defenders
        </h1>
        <p className="mt-2 text-sm text-ink-soft sm:mt-3 sm:text-lg">
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
          <div className="mt-8 grid grid-cols-3 items-end gap-2 sm:mt-10 sm:gap-4">
            {podium.map((p) => (
              <div
                key={p.user_id}
                className={`flex min-w-0 flex-col items-center rounded-2xl bg-card p-3 text-white shadow-sm sm:rounded-3xl sm:p-6 ${
                  p.rank === 1
                    ? 'order-2 -mt-3 sm:-mt-6'
                    : p.rank === 2
                      ? 'order-1 mt-3 sm:mt-6'
                      : 'order-3 mt-3 sm:mt-6'
                }`}
              >
                {p.rank === 1 && <span className="text-xl sm:text-2xl">👑</span>}
                <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary/20 text-sm font-extrabold text-secondary sm:h-14 sm:w-14 sm:text-lg">
                  {initials(p.username)}
                </span>
                <span
                  className={`mt-1.5 grid h-6 w-6 place-items-center rounded-full text-xs font-extrabold sm:mt-2 sm:h-8 sm:w-8 sm:text-sm ${podiumBadge[p.rank] ?? 'bg-white/10'}`}
                >
                  {p.rank}
                </span>
                <p className="mt-1.5 max-w-full truncate text-xs font-bold sm:mt-2 sm:text-base">{p.username}</p>
                <span className="mt-1 hidden sm:block">
                  <TierBadge tier={p.tier} />
                </span>
                <p className="mt-1 font-display text-lg font-extrabold text-secondary sm:text-2xl">
                  {Math.round(p.score)}
                </p>
              </div>
            ))}
          </div>

          {/* Ranked table */}
          <section className="mt-8 overflow-hidden rounded-3xl border border-black/5 bg-surface shadow-sm">
            <div className="grid grid-cols-[2rem_1fr_4rem] items-center gap-2 border-b border-black/5 px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-soft sm:grid-cols-[3rem_1fr_7rem_6rem] sm:gap-3 sm:px-5">
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
                  className={`grid grid-cols-[2rem_1fr_4rem] items-center gap-2 border-b border-black/5 px-4 py-3.5 text-sm last:border-0 sm:grid-cols-[3rem_1fr_7rem_6rem] sm:gap-3 sm:px-5 sm:py-4 ${
                    you ? 'bg-brand/5' : ''
                  }`}
                >
                  <span className="font-display text-base font-extrabold text-ink-faint sm:text-lg">
                    {medals[e.rank] ?? e.rank}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold text-card sm:gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary/15 text-xs font-bold text-secondary">
                      {initials(e.username)}
                    </span>
                    <span className="truncate">{e.username}</span>
                    <span className="hidden sm:block">
                      <TierBadge tier={e.tier} />
                    </span>
                    {you && (
                      <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                        YOU
                      </span>
                    )}
                  </span>
                  <span className="hidden text-right font-medium text-ink-soft sm:block">
                    {e.credibility_score.toFixed(2)}
                  </span>
                  <span className="text-right font-bold text-card">{Math.round(e.score)}</span>
                </div>
              )
            })}
          </section>
        </>
      )}

      {/* Weekly rewards */}
      <section className="mt-8 rounded-3xl bg-card p-5 text-white shadow-sm sm:p-8">
        <h2 className="font-display text-lg font-extrabold sm:text-xl">Weekly Rewards</h2>
        <p className="mt-1 text-sm text-white/70">
          Each Monday the top 3 receive a voucher from our partner brands:
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:grid-cols-4 sm:gap-4">
          {['Grab', 'Shopee', 'Starbucks', 'FoodPanda'].map((b) => (
            <div
              key={b}
              className="grid h-16 place-items-center rounded-2xl bg-white/5 text-sm font-semibold text-white/70 ring-1 ring-white/10 sm:h-20 sm:text-base"
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
