import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import {
  contentEmoji,
  formatLikelihood,
  ImpactStars,
  parseCaption,
  previewContent,
  riskFor,
  riskStyle,
} from '../lib/community'
import type {
  LeaderboardEntry,
  LeaderboardScope,
  ScamTypes,
  Stats,
  TrendingItem,
} from '../types/dashboard'

/**
 * Dashboard — "Critical Misinformation Dashboard" (Figma node 39:216), wired to
 * the Phase 7 dashboard-service. Public (no login): headline stats, Scam of the
 * Week, a 4-week verdict timeline, the credibility leaderboard (weekly/all-time),
 * and a trending grid. All data is Redis-cached server-side and refreshed by the
 * AI worker every 15 minutes.
 */
export default function Dashboard() {
  const apiFetch = useApi()
  const [stats, setStats] = useState<Stats | null>(null)
  const [scamTypes, setScamTypes] = useState<ScamTypes | null>(null)
  const [trending, setTrending] = useState<TrendingItem[] | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null)
  const [scope, setScope] = useState<LeaderboardScope>('weekly')
  const [error, setError] = useState('')

  const loadLeaderboard = useCallback(
    async (which: LeaderboardScope) => {
      try {
        const res = await apiFetch(`/api/dashboard/leaderboard?scope=${which}&limit=10`)
        setLeaderboard((await res.json()) as LeaderboardEntry[])
      } catch {
        setLeaderboard([])
      }
    },
    [apiFetch],
  )

  useEffect(() => {
    let active = true
    // Each card resolves independently so a slow/failing endpoint never blanks
    // the others (and the fast ones paint immediately).
    async function get<T>(path: string, set: (value: T) => void) {
      try {
        const res = await apiFetch(path)
        const data = (await res.json()) as T
        if (active) set(data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load the dashboard.')
      }
    }
    void get<Stats>('/api/dashboard/stats', setStats)
    void get<TrendingItem[]>('/api/dashboard/trending?limit=6', setTrending)
    void get<ScamTypes>('/api/dashboard/scam-types', setScamTypes)
    return () => {
      active = false
    }
  }, [apiFetch])

  useEffect(() => {
    void loadLeaderboard(scope)
  }, [scope, loadLeaderboard])

  // Scam of the Week: the highest-ranked trending item judged fake.
  const scamOfWeek = trending?.find(
    (t) => t.verdict === 'likely_fake' || (t.fake_likelihood != null && t.fake_likelihood >= 0.5),
  )

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold text-card sm:text-5xl">
          Critical Misinformation Dashboard
        </h1>
        <p className="mt-3 text-lg text-ink-soft">
          Real-time tracking of the most important misinformation trends
        </p>
      </header>

      {error && (
        <p className="mt-6 rounded-xl bg-risk-high/10 px-4 py-3 text-center text-sm text-risk-high">
          {error}
        </p>
      )}

      {/* Headline stats */}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          emoji="📥"
          tint="bg-brand/10"
          value={stats ? String(stats.submissions_this_week) : '—'}
          label="Submissions this week"
        />
        <StatCard
          emoji="🚩"
          tint="bg-risk-critical/15"
          value={stats ? `${stats.pct_fake}%` : '—'}
          label="Flagged as fake"
        />
        <StatCard
          emoji={stats?.most_common_type ? contentEmoji(stats.most_common_type) : '🗂️'}
          tint="bg-secondary/15"
          value={stats?.most_common_type ? typeLabel(stats.most_common_type) : '—'}
          label="Most common type"
        />
        <StatCard
          emoji="🧑‍🤝‍🧑"
          tint="bg-risk-low/15"
          value={stats ? String(stats.active_users_this_week) : '—'}
          label="Active users this week"
        />
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        {/* Left: Scam of the Week + timeline */}
        <div className="space-y-8">
          <ScamOfWeek item={scamOfWeek} loading={trending === null} />
          <VerdictTimeline data={scamTypes} />
        </div>

        {/* Right: leaderboard */}
        <LeaderboardPanel entries={leaderboard} scope={scope} onScope={setScope} />
      </div>

      {/* Trending grid */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-extrabold text-card">Trending This Week</h2>
        {trending === null ? (
          <p className="mt-6 text-sm text-ink-soft">Loading trending submissions…</p>
        ) : trending.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-black/5 bg-surface p-6 text-sm text-ink-soft">
            No submissions yet this week. Be the first to{' '}
            <Link to="/verify" className="font-semibold text-brand hover:underline">
              submit something suspicious
            </Link>
            .
          </p>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {trending.map((item) => (
              <TrendingCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  emoji,
  tint,
  value,
  label,
}: {
  emoji: string
  tint: string
  value: string
  label: string
}) {
  return (
    <div className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <span className={`grid h-12 w-12 place-items-center rounded-xl text-2xl ${tint}`}>{emoji}</span>
      <p className="mt-4 font-display text-3xl font-extrabold text-card">{value}</p>
      <p className="mt-1 text-sm text-ink-soft">{label}</p>
    </div>
  )
}

function ScamOfWeek({ item, loading }: { item: TrendingItem | undefined; loading: boolean }) {
  if (loading) {
    return (
      <section className="rounded-3xl bg-card p-6 text-white shadow-sm">
        <p className="animate-pulse text-sm text-white/70">Loading Scam of the Week…</p>
      </section>
    )
  }
  if (!item) {
    return (
      <section className="rounded-3xl bg-card p-6 text-white shadow-sm">
        <h2 className="font-display text-xl font-extrabold">🏆 Scam of the Week</h2>
        <p className="mt-3 text-sm text-white/70">
          No high-risk submissions yet this week — the community is keeping things clean.
        </p>
      </section>
    )
  }
  const { category } = parseCaption(item.caption)
  return (
    <section className="rounded-3xl bg-card p-6 text-white shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-extrabold">🏆 Scam of the Week</h2>
        <span className="rounded-full bg-risk-critical/30 px-3 py-1 text-xs font-bold text-white">
          {formatLikelihood(item.fake_likelihood)} likely fake
        </span>
      </div>
      <p className="mt-4 text-lg font-bold">{previewContent(item)}</p>
      {category && <p className="mt-1 text-xs uppercase tracking-wide text-secondary">{category}</p>}
      {item.explanation && (
        <p className="mt-3 rounded-2xl bg-white/5 p-4 text-sm text-white/80 ring-1 ring-white/10">
          {item.explanation}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between">
        <ImpactStars value={item.weighted_impact} inline />
        <Link
          to={`/community/post/${item.id}`}
          className="rounded-xl bg-secondary px-4 py-2 text-sm font-bold text-card transition hover:opacity-90"
        >
          See breakdown →
        </Link>
      </div>
    </section>
  )
}

const VERDICT_SEGMENTS = [
  { key: 'likely_fake', label: 'Likely fake', color: 'bg-risk-critical' },
  { key: 'uncertain', label: 'Uncertain', color: 'bg-ink-faint' },
  { key: 'likely_real', label: 'Likely real', color: 'bg-risk-low' },
] as const

function VerdictTimeline({ data }: { data: ScamTypes | null }) {
  if (!data) {
    return (
      <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
        <p className="text-sm text-ink-soft">Loading verdict timeline…</p>
      </section>
    )
  }
  const maxTotal = Math.max(
    1,
    ...data.weekly.map((w) => w.likely_fake + w.uncertain + w.likely_real),
  )
  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <h2 className="font-display text-xl font-extrabold text-card">Submissions by Verdict</h2>
      <p className="mt-1 text-sm text-ink-soft">Past 4 weeks, stacked by AI verdict</p>

      <div className="mt-6 flex items-end justify-around gap-4" style={{ height: '12rem' }}>
        {data.weekly.map((bucket) => {
          const total = bucket.likely_fake + bucket.uncertain + bucket.likely_real
          return (
            <div key={bucket.week} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <div
                className="flex w-full max-w-[3.5rem] flex-col justify-end overflow-hidden rounded-lg"
                style={{ height: `${(total / maxTotal) * 100}%`, minHeight: total > 0 ? '4px' : '0' }}
                title={`${total} submission(s)`}
                aria-label={`${bucket.week}: ${total} submissions`}
              >
                {VERDICT_SEGMENTS.map((seg) => {
                  const count = bucket[seg.key]
                  if (count === 0) return null
                  return (
                    <div
                      key={seg.key}
                      className={seg.color}
                      style={{ height: `${(count / total) * 100}%` }}
                    />
                  )
                })}
              </div>
              <span className="text-center text-[11px] font-medium text-ink-soft">{bucket.week}</span>
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-4">
        {VERDICT_SEGMENTS.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1.5 text-xs text-ink-soft">
            <span className={`h-3 w-3 rounded-sm ${seg.color}`} />
            {seg.label}
          </span>
        ))}
      </div>
    </section>
  )
}

const tierStyle: Record<string, string> = {
  Expert: 'bg-highlight/25 text-ink',
  Analyst: 'bg-brand/10 text-brand',
  Verified: 'bg-secondary/15 text-secondary',
  Newcomer: 'bg-ink-faint/15 text-ink-soft',
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tierStyle[tier] ?? tierStyle.Newcomer}`}>
      {tier}
    </span>
  )
}

const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function LeaderboardPanel({
  entries,
  scope,
  onScope,
}: {
  entries: LeaderboardEntry[] | null
  scope: LeaderboardScope
  onScope: (s: LeaderboardScope) => void
}) {
  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-extrabold text-card">Top Defenders</h2>
        <div className="flex gap-1 rounded-full bg-bg p-1">
          {(['weekly', 'alltime'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onScope(s)}
              aria-pressed={scope === s}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                scope === s ? 'bg-brand text-white' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {s === 'weekly' ? 'This Week' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {entries === null ? (
        <p className="mt-5 text-sm text-ink-soft">Loading leaderboard…</p>
      ) : entries.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-bg p-4 text-sm text-ink-soft">
          No rankings yet. Play a{' '}
          <Link to="/learn" className="font-semibold text-brand hover:underline">
            game
          </Link>{' '}
          to climb the board.
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {entries.map((e) => (
            <li
              key={e.user_id}
              className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-2xl bg-bg px-4 py-3"
            >
              <span className="font-display text-lg font-extrabold text-ink-faint">
                {medals[e.rank] ?? e.rank}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold text-card">{e.username}</span>
                <TierBadge tier={e.tier} />
              </span>
              <span className="text-right font-display text-lg font-extrabold text-brand">
                {Math.round(e.score)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TrendingCard({ item }: { item: TrendingItem }) {
  const risk = riskFor(item.fake_likelihood)
  const { category } = parseCaption(item.caption)
  return (
    <Link
      to={`/community/post/${item.id}`}
      className="block rounded-3xl border border-black/5 bg-surface p-5 shadow-sm transition hover:border-brand/30 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-xl">{contentEmoji(item.content_type)}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${riskStyle[risk.tone]}`}>
          {risk.label}
        </span>
      </div>
      <p className="mt-3 line-clamp-3 font-semibold text-card">{previewContent(item)}</p>
      {category && <p className="mt-2 text-xs uppercase tracking-wide text-ink-faint">{category}</p>}
      <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
        <span>{formatLikelihood(item.fake_likelihood)} likely fake</span>
        <ImpactStars value={item.weighted_impact} inline />
      </div>
      <p className="mt-1 text-xs text-ink-faint">{item.vote_count} community votes</p>
    </Link>
  )
}

function typeLabel(contentType: string): string {
  if (contentType === 'url') return 'Links'
  if (contentType === 'image') return 'Images'
  if (contentType === 'text') return 'Text'
  return contentType
}
