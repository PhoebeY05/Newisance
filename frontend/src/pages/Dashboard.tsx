import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import TierBadge from '../components/TierBadge'
import {
  contentEmoji,
  formatLikelihood,
  ImpactStars,
  isMediaPath,
  MediaThumb,
  parseCaption,
  previewContent,
  riskFor,
  riskStyle,
} from '../lib/community'
import type { LeaderboardEntry, ScamTypes, Stats, TrendingItem } from '../types/dashboard'

/**
 * Dashboard — "Critical Misinformation Dashboard" (Figma node 39:216), wired to
 * the Phase 7 dashboard-service. Public (no login): headline stats, Scam of the
 * Week, a 4-week verdict timeline, the credibility leaderboard (weekly/all-time),
 * and a trending grid. All data is Redis-cached server-side and refreshed by the
 * AI worker every 15 minutes.
 */
export default function Dashboard() {
  const apiFetch = useApi()
  const mountedRef = useRef(true)
  const [stats, setStats] = useState<Stats | null>(null)
  const [scamTypes, setScamTypes] = useState<ScamTypes | null>(null)
  const [trending, setTrending] = useState<TrendingItem[] | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadDashboard = useCallback(async (refresh = false) => {
    setRefreshing(true)
    setError('')

    const refreshParam = refresh ? 'refresh=true' : 'refresh=false'
    async function get<T>(path: string, set: (value: T) => void) {
      try {
        const res = await apiFetch(path)
        if (!res.ok) throw new Error(`Dashboard request failed: ${res.status}`)
        const data = (await res.json()) as T
        if (mountedRef.current) set(data)
      } catch (err) {
        if (mountedRef.current) setError(err instanceof Error ? err.message : 'Could not load the dashboard.')
      }
    }

    await Promise.all([
      get<Stats>(`/api/dashboard/stats?${refreshParam}`, setStats),
      get<TrendingItem[]>(`/api/dashboard/trending?limit=6&${refreshParam}`, setTrending),
      get<ScamTypes>(`/api/dashboard/scam-types?${refreshParam}`, setScamTypes),
      get<LeaderboardEntry[]>(`/api/dashboard/leaderboard?scope=weekly&limit=5&${refreshParam}`, setLeaderboard),
    ])
    if (mountedRef.current) {
      setLastUpdated(new Date())
      setRefreshing(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void loadDashboard(true)
    const interval = window.setInterval(() => {
      void loadDashboard(true)
    }, 30000)
    return () => {
      window.clearInterval(interval)
    }
  }, [loadDashboard])

  // Scam of the Week: the highest-ranked trending item judged fake.
  const scamOfWeek = trending?.find(
    (t) => t.verdict === 'likely_fake' || (t.fake_likelihood != null && t.fake_likelihood >= 0.5),
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="text-center">
        <h1 className="font-display text-2xl font-extrabold text-card sm:text-5xl">
          Critical Misinformation Dashboard
        </h1>
        <p className="mt-2 text-sm text-ink-soft sm:mt-3 sm:text-lg">
          Real-time tracking of the most important misinformation trends
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void loadDashboard(true)}
            disabled={refreshing}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light disabled:opacity-60"
          >
            {refreshing ? 'Refreshing...' : 'Refresh data'}
          </button>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting for live data'}
          </span>
        </div>
      </header>

      {error && (
        <p className="mt-6 rounded-xl bg-risk-high/10 px-4 py-3 text-center text-sm text-risk-high">
          {error}
        </p>
      )}

      {/* Headline stats */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-4">
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
          value={stats?.distinct_submitters_this_week == null ? '—' : String(stats.distinct_submitters_this_week)}
          label="Submitters this week"
        />
      </div>

      {/* Feature card + verdict chart — a balanced, similar-height pair */}
      <div className="mt-8 grid items-start gap-5 sm:mt-12 sm:gap-8 lg:grid-cols-[1.3fr_1fr]">
        <ScamOfWeek item={scamOfWeek} loading={trending === null} />
        <VerdictTimeline data={scamTypes} />
      </div>

      {/* Most-targeted topics — a single proportion-bar card */}
      <TopicsCard data={scamTypes} />

      <LeaderboardPreview entries={leaderboard} />

      {/* Trending grid */}
      <section className="mt-8 sm:mt-12">
        <h2 className="font-display text-xl font-extrabold text-card sm:text-2xl">Trending This Week</h2>
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
    <div className="rounded-2xl border border-black/5 bg-surface p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <span className={`grid h-10 w-10 place-items-center rounded-xl text-xl sm:h-12 sm:w-12 sm:text-2xl ${tint}`}>
        {emoji}
      </span>
      <p className="mt-3 font-display text-xl font-extrabold text-card sm:mt-4 sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-ink-soft sm:text-sm">{label}</p>
    </div>
  )
}

function LeaderboardPreview({ entries }: { entries: LeaderboardEntry[] | null }) {
  return (
    <section className="mt-12 rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-card">Weekly Leaders</h2>
          <p className="mt-1 text-sm text-ink-soft">Live game scores from this week's leaderboard</p>
        </div>
        <Link
          to="/leaderboard"
          className="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light"
        >
          Full board
        </Link>
      </div>

      {entries === null ? (
        <p className="mt-5 text-sm text-ink-soft">Loading leaders...</p>
      ) : entries.length === 0 ? (
        <p className="mt-5 text-sm text-ink-soft">
          No leaderboard scores yet. Play a round to put points on the board.
        </p>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {entries.map((entry) => (
            <div key={entry.user_id} className="rounded-2xl bg-bg p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-extrabold text-brand">#{entry.rank}</span>
                <TierBadge tier={entry.tier} />
              </div>
              <p className="mt-2 truncate font-semibold text-card">{entry.username}</p>
              <p className="mt-1 text-sm text-ink-soft">{Math.round(entry.score)} points</p>
            </div>
          ))}
        </div>
      )}
    </section>
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold sm:text-xl">🏆 Scam of the Week</h2>
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
      <div className="mt-5 flex items-center justify-between">
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

const CATEGORY_STYLE: Record<string, { emoji: string; bar: string }> = {
  Politics: { emoji: '🏛️', bar: 'bg-brand' },
  'Health & Medical': { emoji: '🩺', bar: 'bg-secondary' },
  Technology: { emoji: '💻', bar: 'bg-highlight' },
  Finance: { emoji: '💰', bar: 'bg-risk-med' },
}

const CATEGORY_FALLBACK = { emoji: '🏷️', bar: 'bg-ink-faint' }

function TopicsCard({ data }: { data: ScamTypes | null }) {
  return (
    <section className="mt-8 rounded-3xl border border-black/5 bg-surface p-5 shadow-sm sm:mt-12 sm:p-6">
      <h2 className="font-display text-lg font-extrabold text-card sm:text-xl">Most Targeted Topics</h2>
      <p className="mt-1 text-sm text-ink-soft">Subjects misinformation focuses on most</p>

      {data === null ? (
        <p className="mt-5 text-sm text-ink-soft">Loading topics…</p>
      ) : data.by_category.length === 0 ? (
        <p className="mt-5 text-sm text-ink-soft">
          No tagged submissions yet. Topics appear once content is{' '}
          <Link to="/verify" className="font-semibold text-brand hover:underline">
            flagged with a category
          </Link>
          .
        </p>
      ) : (
        (() => {
          const total = Math.max(1, data.by_category.reduce((sum, c) => sum + c.count, 0))
          return (
            <>
              {/* One stacked proportion bar across all categories */}
              <div className="mt-6 flex h-4 overflow-hidden rounded-full bg-bg">
                {data.by_category.map((c) => {
                  const style = CATEGORY_STYLE[c.category] ?? CATEGORY_FALLBACK
                  return (
                    <div
                      key={c.category}
                      className={style.bar}
                      style={{ width: `${(c.count / total) * 100}%` }}
                      title={`${c.category}: ${c.count}`}
                    />
                  )
                })}
              </div>

              {/* Legend */}
              <ul className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                {data.by_category.map((c) => {
                  const style = CATEGORY_STYLE[c.category] ?? CATEGORY_FALLBACK
                  const pct = Math.round((c.count / total) * 100)
                  return (
                    <li key={c.category} className="flex items-center gap-2 text-sm">
                      <span className={`h-3 w-3 shrink-0 rounded-sm ${style.bar}`} />
                      <span>{style.emoji}</span>
                      <span className="truncate font-medium text-card">{c.category}</span>
                      <span className="ml-auto shrink-0 font-semibold text-ink-soft">
                        {c.count} · {pct}%
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )
        })()
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
      {isMediaPath(item.content_url) ? (
        <div className="mt-3 h-40 overflow-hidden rounded-xl">
          <MediaThumb contentUrl={item.content_url} />
        </div>
      ) : (
        <p className="mt-3 line-clamp-3 font-semibold text-card">{previewContent(item)}</p>
      )}
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
