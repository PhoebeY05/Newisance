import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../context/AuthContext'
import TierBadge from '../components/TierBadge'

interface ProfileStats {
  credibility_score: number
  tier: string
  game_accuracy: number | null
  questions_answered: number
  games_played: number
  vote_accuracy: number | null
  votes_cast: number
  votes_settled: number
}

interface CredibilityLogEntry {
  delta: number
  reason: string
  new_score: number
  created_at: string
}

const TIER_STROKE: Record<string, string> = {
  Newcomer: 'stroke-ink-faint',
  Verified: 'stroke-risk-low',
  Analyst: 'stroke-brand',
  Expert: 'stroke-highlight',
}

/**
 * Profile — "Your Credibility" (Phase 8). Animated arc meter of the credibility
 * score, tier badge, a 30-day trend line, and a game-accuracy vs vote-accuracy
 * breakdown. Reads /users/me/stats and /users/me/credibility-log.
 */
export default function Profile() {
  const apiFetch = useApi()
  const { user } = useAuth()
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [log, setLog] = useState<CredibilityLogEntry[] | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const res = await apiFetch('/api/community/users/me/stats')
        if (active) setStats((await res.json()) as ProfileStats)
      } catch {
        /* fall back to the AuthContext user below */
      }
    })()
    void (async () => {
      try {
        const res = await apiFetch('/api/community/users/me/credibility-log?days=30')
        if (active) setLog((await res.json()) as CredibilityLogEntry[])
      } catch {
        if (active) setLog([])
      }
    })()
    return () => {
      active = false
    }
  }, [apiFetch])

  const score = stats?.credibility_score ?? user?.credibility_score ?? 0
  const scoreUpdatedAt = log && log.length > 0 ? log[log.length - 1].created_at : null
  const tier = stats?.tier ?? user?.tier ?? 'Newcomer'
  const voteWeight = user?.is_guest ? 0.1 : Math.min(score / 100, 1)

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-card sm:text-4xl">Your Credibility</h1>
          <p className="mt-2 text-ink-soft">
            Accurate calls raise your score — and your votes carry more weight.
          </p>
        </div>
        <Link to="/account" className="text-sm font-semibold text-brand hover:underline">
          Account settings →
        </Link>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* Score meter */}
        <section className="rounded-3xl border border-black/5 bg-surface p-6 text-center shadow-sm">
          <ScoreArc score={score} tier={tier} />
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="font-display text-xl font-extrabold text-card">{user?.username ?? 'You'}</span>
            <TierBadge tier={tier} />
          </div>
          <p className="mt-3 rounded-2xl bg-bg px-4 py-2 text-sm text-ink-soft">
            Your votes carry <b className="text-brand">{voteWeight.toFixed(2)}×</b> weight
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            Score last updated: {scoreUpdatedAt ? new Date(scoreUpdatedAt).toLocaleString() : 'No recent changes'}
          </p>
        </section>

        {/* Accuracy breakdown */}
        <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
          <h2 className="font-display text-xl font-extrabold text-card">Accuracy</h2>
          <p className="mt-1 text-sm text-ink-soft">How often you call it right</p>

          <div className="mt-6 space-y-5">
            <AccuracyBar
              label="🎮 Game accuracy"
              value={stats?.game_accuracy ?? null}
              meta={stats ? `${stats.questions_answered} answered · ${stats.games_played} games` : ''}
              color="bg-brand"
            />
            <AccuracyBar
              label="🗳️ Vote accuracy"
              value={stats?.vote_accuracy ?? null}
              meta={
                stats ? `${stats.votes_settled} settled · ${stats.votes_cast} cast` : ''
              }
              color="bg-secondary"
            />
          </div>
        </section>
      </div>

      {/* 30-day trend */}
      <section className="mt-6 rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
        <h2 className="font-display text-xl font-extrabold text-card">Last 30 Days</h2>
        <p className="mt-1 text-sm text-ink-soft">Your credibility score over time</p>
        <TrendChart log={log} current={score} />
      </section>
    </div>
  )
}

function ScoreArc({ score, tier }: { score: number; tier: string }) {
  const R = 70
  const STROKE = 14
  const C = 2 * Math.PI * R
  const clamped = Math.max(0, Math.min(100, score))
  // Animate from empty to the target offset after mount.
  const [offset, setOffset] = useState(C)
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(C * (1 - clamped / 100)))
    return () => cancelAnimationFrame(id)
  }, [C, clamped])

  return (
    <div className="relative mx-auto h-[180px] w-[180px]">
      <svg width="180" height="180" viewBox="0 0 180 180" className="-rotate-90">
        <circle cx="90" cy="90" r={R} fill="none" strokeWidth={STROKE} className="stroke-black/5" />
        <circle
          cx="90"
          cy="90"
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          className={TIER_STROKE[tier] ?? TIER_STROKE.Newcomer}
          style={{ transition: 'stroke-dashoffset 0.9s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-extrabold text-card">{score.toFixed(2)}</span>
        <span className="text-xs text-ink-soft">/ 100</span>
      </div>
    </div>
  )
}

function AccuracyBar({
  label,
  value,
  meta,
  color,
}: {
  label: string
  value: number | null
  meta: string
  color: string
}) {
  const pct = value == null ? 0 : Math.round(value * 100)
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-card">{label}</span>
        <span className="font-semibold text-ink-soft">{value == null ? 'No data yet' : `${pct}%`}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-bg">
        <div className={`h-full ${color} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
      </div>
      {meta && <p className="mt-1 text-xs text-ink-faint">{meta}</p>}
    </div>
  )
}

function TrendChart({ log, current }: { log: CredibilityLogEntry[] | null; current: number }) {
  const points = useMemo(() => {
    if (!log) return null
    // Plot the running score after each change; end on the current score.
    const scores = log.map((e) => e.new_score)
    scores.push(current)
    return scores
  }, [log, current])

  if (points === null) {
    return <p className="mt-6 text-sm text-ink-soft">Loading trend…</p>
  }
  if (points.length < 2) {
    return (
      <p className="mt-6 rounded-2xl bg-bg p-4 text-sm text-ink-soft">
        Not enough history yet. Play a{' '}
        <Link to="/learn" className="font-semibold text-brand hover:underline">
          game
        </Link>{' '}
        or vote on{' '}
        <Link to="/community" className="font-semibold text-brand hover:underline">
          submissions
        </Link>{' '}
        to start tracking your credibility.
      </p>
    )
  }

  const W = 600
  const H = 160
  const PAD = 8
  const n = points.length
  const xy = points.map((s, i) => {
    const x = PAD + (i / (n - 1)) * (W - 2 * PAD)
    const y = PAD + (1 - Math.max(0, Math.min(100, s)) / 100) * (H - 2 * PAD)
    return [x, y] as const
  })
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`

  return (
    <div className="mt-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" preserveAspectRatio="none">
        {[0, 25, 50, 75, 100].map((g) => {
          const y = PAD + (1 - g / 100) * (H - 2 * PAD)
          return <line key={g} x1={PAD} y1={y} x2={W - PAD} y2={y} className="stroke-black/5" strokeWidth={1} />
        })}
        <polygon points={area} className="fill-brand/10" />
        <polyline
          points={line}
          fill="none"
          className="stroke-brand"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} className="fill-brand" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-ink-faint">
        <span>30 days ago</span>
        <span>now · {current.toFixed(2)}</span>
      </div>
    </div>
  )
}
