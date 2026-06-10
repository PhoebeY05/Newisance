import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApi } from '../hooks/useApi'
import TierBadge from '../components/TierBadge'
import type { LeaderboardEntry, LeaderboardScope, LeaderboardScoringBreakdown } from '../types/dashboard'

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
  const apiFetch = useApi()
  const [scope, setScope] = useState<LeaderboardScope>('weekly')
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)
  const [scoringOpen, setScoringOpen] = useState(false)
  const [scoring, setScoring] = useState<LeaderboardScoringBreakdown | null>(null)
  const [scoringError, setScoringError] = useState('')

  const openScoring = useCallback(async () => {
    setScoringOpen(true)
    if (scoring) return
    setScoringError('')
    try {
      const response = await apiFetch('/api/dashboard/leaderboard/scoring-breakdown')
      setScoring((await response.json()) as LeaderboardScoringBreakdown)
    } catch (err) {
      setScoringError(err instanceof Error ? err.message : 'Could not load scoring details.')
    }
  }, [apiFetch, scoring])

  useEffect(() => {
    let alive = true
    setEntries(null)
    void apiFetch(`/api/dashboard/leaderboard?scope=${scope}&limit=50&refresh=true`)
      .then(async (response) => {
        if (alive) setEntries((await response.json()) as LeaderboardEntry[])
      })
      .catch(() => {
        if (alive) setEntries((prev) => (prev === null ? [] : prev))
      })

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
    return () => {
      alive = false
      source.close()
    }
  }, [apiFetch, scope])

  const displayedEntries =
    entries && user && !entries.some((entry) => entry.user_id === user.id)
      ? [
        ...entries,
        {
          rank: entries.length + 1,
          user_id: user.id,
          username: user.username,
          score: 0,
          credibility_score: user.credibility_score,
          tier: user.tier,
        },
      ]
      : entries
  const podium = displayedEntries ? displayedEntries.slice(0, 3) : []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="text-center">
        <div className="flex items-center justify-center gap-2">
          <h1 className="font-display text-3xl font-extrabold text-card sm:text-5xl">
            Top Newisance Defenders
          </h1>
          <button
            type="button"
            onClick={() => void openScoring()}
            aria-label="Show scoring breakdown"
            className="grid h-8 w-8 place-items-center rounded-full border border-brand/20 bg-brand/5 text-sm font-black text-brand transition hover:bg-brand/10"
          >
            i
          </button>
        </div>
        <p className="mt-2 text-sm text-ink-soft sm:mt-2 sm:text-lg">
          The most accurate and knowledgable fact-checkers in our community
        </p>
      </header>

      {/* Timeframe tabs */}
      <div className="mt-8 flex justify-center gap-3">
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
            className={`rounded-full px-5 py-2 text-sm font-bold transition ${scope === value ? 'bg-brand text-white shadow-sm' : 'bg-white text-ink-soft hover:text-ink'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {entries === null ? (
        <p className="mt-12 text-center text-ink-soft">Loading leaderboard…</p>
      ) : displayedEntries && displayedEntries.length === 0 ? (
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
          {/* Podium (top 3) */}
          <div className="mx-auto mt-8 grid max-w-5xl grid-cols-3 items-end gap-2 sm:mt-10 sm:gap-4">
            {podium.map((p) => (
              <div
                key={p.user_id}
                className={`flex min-w-0 flex-col items-center rounded-2xl bg-card p-3 text-white shadow-sm sm:rounded-3xl sm:p-6 ${p.rank === 1
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
          <section className="mx-auto mt-9 max-w-5xl overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm">
            <div className="grid grid-cols-[4rem_1fr_6rem] items-center gap-3 border-b border-black/5 px-5 py-4 text-xs font-extrabold uppercase tracking-wide text-ink-soft sm:grid-cols-[5rem_1fr_8rem_6rem]">
              <span>Rank</span>
              <span>User</span>
              <span className="hidden text-right sm:block">Credibility</span>
              <span className="text-right">Score</span>
            </div>

            {displayedEntries?.map((e) => {
              const you = user?.id === e.user_id
              return (
                <div
                  key={e.user_id}
                  className={`grid grid-cols-[4rem_1fr_6rem] items-center gap-3 border-b border-black/5 px-5 py-4 text-base last:border-0 sm:grid-cols-[5rem_1fr_8rem_6rem] ${you ? 'bg-brand/5' : ''
                    }`}
                >
                  <span className="font-display text-lg font-extrabold text-ink-faint">
                    {medals[e.rank] ?? e.rank}
                  </span>
                  <span className="flex min-w-0 items-center gap-3 font-extrabold text-card">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary/15 text-sm font-bold text-secondary">
                      {initials(e.username)}
                    </span>
                    <span className="truncate">{e.username}</span>
                    <span className="hidden sm:inline-flex">
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
                  <span className="text-right font-extrabold text-card">{Math.round(e.score)}</span>
                </div>
              )
            })}
          </section>
        </>
      )}

      {/* Weekly rewards */}
      <section className="mx-auto mt-8 max-w-5xl rounded-3xl bg-card p-5 text-white shadow-sm sm:p-8">
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

      {scoringOpen && (
        <ScoringModal
          scoring={scoring}
          error={scoringError}
          onClose={() => setScoringOpen(false)}
        />
      )}
    </div>
  )
}

function ScoringModal({
  scoring,
  error,
  onClose,
}: {
  scoring: LeaderboardScoringBreakdown | null
  error: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-3xl bg-surface p-6 text-left shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-extrabold text-card">Scoring Breakdown</h2>
            <p className="mt-1 text-sm text-ink-soft">How leaderboard points are awarded.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scoring breakdown"
            className="grid h-9 w-9 place-items-center rounded-full bg-bg text-ink-soft transition hover:bg-black/5"
          >
            x
          </button>
        </div>
        {error ? (
          <p className="mt-5 rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{error}</p>
        ) : scoring === null ? (
          <p className="mt-5 text-sm text-ink-soft">Loading scoring details...</p>
        ) : (
          <div className="mt-5 space-y-4 text-sm text-ink-soft">
            <p>{scoring.summary}</p>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(scoring.difficulty_points).map(([difficulty, points]) => (
                <div key={difficulty} className="rounded-2xl bg-bg p-3 text-center">
                  <p className="text-xs font-bold uppercase text-ink-faint">{difficulty}</p>
                  <p className="font-display text-xl font-extrabold text-brand">{points}</p>
                </div>
              ))}
            </div>
            <p>
              <b className="text-card">Formula:</b> {scoring.formula}
            </p>
            <p>
              <b className="text-card">Speed:</b> {scoring.speed_bonus.description}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {scoring.battle_modifiers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
