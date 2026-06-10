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
import type { SubmissionFeed, SubmissionOut } from '../types/community'
import type {
  LeaderboardEntry,
  OfficialTrends,
  ScamEducationItem,
  ScamTypes,
  Stats,
  TrendingItem,
} from '../types/dashboard'

type DashboardTab = 'community' | 'official' | 'education'

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
  const [communityReports, setCommunityReports] = useState<SubmissionOut[] | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null)
  const [education, setEducation] = useState<ScamEducationItem[] | null>(null)
  const [officialTrends, setOfficialTrends] = useState<OfficialTrends | null>(null)
  const [activeTab, setActiveTab] = useState<DashboardTab>('community')
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
      get<SubmissionFeed>('/api/community/submissions?page=1&page_size=50', (feed) => setCommunityReports(feed.items)),
      get<ScamTypes>(`/api/dashboard/scam-types?${refreshParam}`, setScamTypes),
      get<LeaderboardEntry[]>(`/api/dashboard/leaderboard?scope=weekly&limit=5&${refreshParam}`, setLeaderboard),
      get<ScamEducationItem[]>(`/api/dashboard/scam-education?limit=12&${refreshParam}`, setEducation),
      get<OfficialTrends>('/api/dashboard/official-trends?limit=6', setOfficialTrends),
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

      <DashboardTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'community' && (
        <>
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
        </>
      )}

      {activeTab === 'official' && (
        <OfficialTrendsPanel
          officialTrends={officialTrends}
          scamTypes={scamTypes}
          trending={trending}
          communityReports={communityReports}
        />
      )}

      {activeTab === 'education' && <ScamEducationHub items={education} />}
    </div>
  )
}

function DashboardTabs({
  activeTab,
  onChange,
}: {
  activeTab: DashboardTab
  onChange: (tab: DashboardTab) => void
}) {
  const tabs: Array<{ id: DashboardTab; label: string; helper: string }> = [
    { id: 'community', label: 'Community Reports', helper: 'Newisance user reports' },
    { id: 'official', label: 'Official Scam Trends', helper: 'Government trend sources' },
    { id: 'education', label: 'How Current Scams Work', helper: 'ScamShield education' },
  ]

  return (
    <div className="mt-8 grid gap-2 rounded-2xl border border-black/5 bg-surface p-2 shadow-sm lg:grid-cols-3">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`rounded-xl px-4 py-3 text-left transition ${
              isActive ? 'bg-card text-white shadow-sm' : 'text-card hover:bg-bg'
            }`}
          >
            <span className="block text-sm font-extrabold sm:text-base">{tab.label}</span>
            <span className={`mt-0.5 block text-xs ${isActive ? 'text-white/70' : 'text-ink-soft'}`}>
              {tab.helper}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function OfficialTrendsPanel({
  officialTrends,
  scamTypes,
  trending,
  communityReports,
}: {
  officialTrends: OfficialTrends | null
  scamTypes: ScamTypes | null
  trending: TrendingItem[] | null
  communityReports: SubmissionOut[] | null
}) {
  const [selectedTrend, setSelectedTrend] = useState<OfficialTrends['items'][number] | null>(null)
  const [selectedComparison, setSelectedComparison] = useState<TrendComparison | null>(null)
  const comparisonReports = mergeComparisonReports(trending ?? [], communityReports ?? [])
  const trendComparisons = buildTrendComparisons(officialTrends?.items ?? [], scamTypes, comparisonReports)
  const matchedCount = trendComparisons.filter((item) => item.level !== 'none').length

  return (
    <section className="mt-8">
      <div className="rounded-3xl bg-card p-6 text-white shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-secondary">Official source</p>
            <h2 className="mt-2 font-display text-2xl font-extrabold">
              {officialTrends?.title ?? 'Latest Scam Trends'}
            </h2>
            <p className="mt-3 max-w-3xl text-sm text-white/75">
              {officialTrends?.summary ??
                'Top three latest advisories from I Can ACT Against Scams, summarised into warning signs and prevention steps.'}
            </p>
          </div>
          <a
            href={officialTrends?.source_url ?? 'https://www.icanactagainstscams.gov.sg/scam-trends'}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-xl bg-secondary px-4 py-2 text-sm font-bold text-card transition hover:opacity-90"
          >
            Open official trends
          </a>
        </div>
      </div>

      {officialTrends === null ? (
        <p className="mt-5 rounded-2xl border border-black/5 bg-surface p-6 text-sm text-ink-soft">
          Loading the latest official advisory cards...
        </p>
      ) : officialTrends.items.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-black/5 bg-surface p-6 text-sm text-ink-soft">
          Official trend details could not be extracted right now. Open the source page for the latest update.
        </p>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {officialTrends.items.map((item, index) => (
            <OfficialTrendCard key={item.id} item={item} rank={index + 1} onOpen={setSelectedTrend} />
          ))}
        </div>
      )}

      {selectedTrend && (
        <OfficialTrendModal item={selectedTrend} onClose={() => setSelectedTrend(null)} />
      )}

      <div className="mt-6 rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h3 className="font-display text-xl font-extrabold text-card">Do our reports match the 6 latest advisories?</h3>
            <p className="mt-1 text-sm text-ink-soft">
              These cards compare Newisance community reports against the six official scam trend advisories shown above.
              Scores use specific category, brand, title, and suspicious-domain matches.
            </p>
          </div>
          <div className="rounded-2xl bg-bg px-4 py-3 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Official trends matched</p>
            <p className="mt-1 font-display text-2xl font-extrabold text-brand">
              {officialTrends ? `${matchedCount}/${officialTrends.items.length}` : '...'}
            </p>
          </div>
        </div>

        {officialTrends === null ? (
          <p className="mt-5 rounded-2xl bg-bg p-4 text-sm text-ink-soft">Comparing reports...</p>
        ) : trendComparisons.length === 0 ? (
          <p className="mt-5 rounded-2xl bg-bg p-4 text-sm text-ink-soft">
            No official advisories are available for comparison yet.
          </p>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {trendComparisons.map((comparison) => (
              <TrendComparisonCard
                key={comparison.id}
                comparison={comparison}
                onOpenMatches={setSelectedComparison}
              />
            ))}
          </div>
        )}

        {selectedComparison && (
          <TrendMatchesModal comparison={selectedComparison} onClose={() => setSelectedComparison(null)} />
        )}

      </div>
    </section>
  )
}

function OfficialTrendCard({
  item,
  rank,
  onOpen,
}: {
  item: OfficialTrends['items'][number]
  rank: number
  onOpen: (item: OfficialTrends['items'][number]) => void
}) {
  const tags = item.tags.slice(0, 3)
  return (
    <article className="overflow-hidden rounded-3xl border border-black/5 bg-surface shadow-sm transition hover:border-brand/30 hover:shadow-md">
      <button type="button" onClick={() => onOpen(item)} className="block h-full w-full text-left">
      <div className="relative h-44 bg-bg">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="h-full w-full object-contain p-3" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center bg-card text-center text-sm font-bold text-white/70">
            Official advisory
          </div>
        )}
        <div className="absolute left-4 top-4 rounded-full bg-card px-3 py-1 text-xs font-extrabold text-white">
          Latest #{rank}
        </div>
        <div className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-brand">
          {item.category}
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-extrabold text-card">{item.title}</h3>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-bold text-ink-faint">{item.date}</span>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand">
                {tag}
              </span>
            ))}
          </div>
        )}
        <p className="mt-4 line-clamp-3 text-sm text-ink-soft">{item.summary}</p>
        <span className="mt-5 inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light">
          View details
        </span>
      </div>
      </button>
    </article>
  )
}

function OfficialTrendModal({
  item,
  onClose,
}: {
  item: OfficialTrends['items'][number]
  onClose: () => void
}) {
  const warnings = item.warning_signs.slice(0, 3).map(shortWarning)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-card/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close modal" />
      <article className="relative max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-surface shadow-2xl">
        <div className="relative h-56 bg-bg sm:h-72">
          {item.image_url ? (
            <img src={item.image_url} alt="" className="h-full w-full object-contain p-4" />
          ) : (
            <div className="grid h-full place-items-center bg-card text-sm font-bold text-white/70">
              Official advisory
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white text-lg font-extrabold text-card shadow-sm"
            aria-label="Close"
          >
            x
          </button>
          <div className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-brand">
            {item.category}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <h3 className="font-display text-xl font-extrabold text-card sm:text-2xl">{item.title}</h3>
            <span className="shrink-0 text-xs font-bold text-ink-faint">{item.date}</span>
          </div>
          <p className="mt-3 text-sm text-ink-soft">{item.summary}</p>

          {item.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.tags.slice(0, 5).map((tag) => (
                <span key={tag} className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {item.scam_site_urls.length > 0 && (
          <div className="mt-4 rounded-2xl bg-risk-critical/10 p-3">
            <p className="text-xs font-extrabold uppercase tracking-wide text-risk-critical">Reported scam sites</p>
            <p className="mt-1 break-words text-sm font-semibold text-card">
              {item.scam_site_urls.slice(0, 3).join(', ')}
            </p>
          </div>
        )}

          <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-sm font-extrabold text-card">Warning signs</p>
              <ul className="mt-2 grid gap-2">
                {warnings.map((warning, index) => (
                  <li key={warning} className="flex items-start gap-2 rounded-xl bg-bg px-3 py-2 text-sm text-ink-soft">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-risk-critical/15 text-xs font-extrabold text-risk-critical">
                      {warningIcon(index)}
                    </span>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm font-extrabold text-card">Prevention flow</p>
              <div className="mt-3 grid gap-3">
                {item.prevention_steps.slice(0, 3).map((step, index) => (
                  <div key={`${step.label}-${step.text}`} className="flex gap-3 rounded-2xl bg-bg p-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-sm font-extrabold text-card">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-card">{step.label}</p>
                      <p className="mt-0.5 text-sm text-ink-soft">{step.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light"
            >
              View source
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-bg px-4 py-2 text-sm font-bold text-card transition hover:bg-black/5"
            >
              Close
            </button>
          </div>
                </div>
      </article>
    </div>
  )
}

function shortWarning(warning: string): string {
  const cleaned = warning
    .replace(/^check for scam signs:\s*/i, '')
    .replace(/^unrealistic promises:\s*/i, '')
    .replace(/^suspicious websites:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned
  if (sentence.length <= 92) return sentence
  const words = sentence.slice(0, 92).split(' ')
  words.pop()
  return `${words.join(' ')}...`
}

function warningIcon(index: number): string {
  return ['!', '$', '?'][index] ?? '!'
}

type TrendComparison = {
  id: string
  title: string
  imageUrl: string | null
  category: string
  level: 'strong' | 'partial' | 'none'
  label: string
  reason: string
  matchedTerms: string[]
  matchedReports: number
  similarityScore: number
  matchedListings: MatchedListing[]
  matchedReportId: number | null
}

type MatchedListing = {
  id: number
  title: string
  score: number
  matchedTerms: string[]
}

type ComparisonReport = {
  id: number
  content_type: string
  content_url: string
  caption: string | null
  explanation?: string | null
}

type MatchTerm = {
  value: string
  weight: number
}

const MATCH_STOPWORDS = new Set([
  'advisory',
  'beware',
  'scams',
  'scam',
  'fake',
  'using',
  'with',
  'the',
  'and',
  'online',
  'emerging',
  'related',
])

function buildTrendComparisons(
  officialItems: OfficialTrends['items'],
  scamTypes: ScamTypes | null,
  reports: ComparisonReport[],
): TrendComparison[] {
  void scamTypes
  const reportTexts = reports.map((item) => {
    const parsed = parseCaption(item.caption)
    const title = previewContent(item)
    return {
      id: item.id,
      title,
      text: normaliseMatchTerm(
        [
          item.content_type,
          item.caption ?? '',
          parsed.category ?? '',
          item.content_url ?? '',
          item.explanation ?? '',
          title,
        ].join(' '),
      ),
    }
  })

  return officialItems.map((item) => {
    const terms = officialTrendTerms(item)
    const maxScore = Math.max(1, terms.reduce((sum, term) => sum + term.weight, 0))
    const matchedListings = reportTexts
      .map((report) => {
        const matchedTerms = terms.filter((term) => matchesTerm(report.text, term.value))
        const weightedScore = matchedTerms.reduce((sum, term) => sum + term.weight, 0)
        return {
          id: report.id,
          title: report.title,
          score: Math.round((weightedScore / maxScore) * 100),
          matchedTerms: matchedTerms.map((term) => term.value),
        }
      })
      .filter((report) => report.score >= 25)
      .sort((a, b) => b.score - a.score)

    const bestMatch = matchedListings[0]
    const matchedTerms = bestMatch?.matchedTerms ?? []
    const similarityScore = bestMatch?.score ?? 0
    const matchedReportItems = matchedListings.length
    const level: TrendComparison['level'] =
      similarityScore >= 65 ? 'strong' : similarityScore >= 25 ? 'partial' : 'none'
    const label =
      level === 'strong' ? 'Strong match' : level === 'partial' ? 'Partial match' : 'No clear match yet'
    const reason =
      level === 'strong'
        ? `Top local report has ${similarityScore}% similarity based on specific category, brand, title, or domain terms.`
        : level === 'partial'
          ? `Top local report has ${similarityScore}% similarity. This is a weak signal, not a confirmed trend match.`
          : 'No local report passed the 25% similarity threshold for this official trend.'

    return {
      id: item.id,
      title: item.title,
      imageUrl: item.image_url,
      category: item.category,
      level,
      label,
      reason,
      matchedTerms,
      matchedReports: matchedReportItems,
      similarityScore,
      matchedListings,
      matchedReportId: bestMatch?.id ?? null,
    }
  })
}

function mergeComparisonReports(trendingItems: TrendingItem[], communityReports: SubmissionOut[]): ComparisonReport[] {
  const merged = new Map<number, ComparisonReport>()
  for (const item of communityReports) {
    merged.set(item.id, item)
  }
  for (const item of trendingItems) {
    merged.set(item.id, item)
  }
  return [...merged.values()]
}

function officialTrendTerms(item: OfficialTrends['items'][number]): MatchTerm[] {
  const titleTerms: MatchTerm[] = item.title
    .split(/[^a-zA-Z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 3 && !MATCH_STOPWORDS.has(term.toLowerCase()))
    .map((value) => ({ value, weight: 2 }))
  const domainTerms: MatchTerm[] = item.scam_site_urls.flatMap((url) =>
    url.split(/[^a-zA-Z0-9]+/).filter((term) => term.length > 4).map((value) => ({ value, weight: 5 })),
  )
  return dedupeMatchTerms([
    { value: item.category, weight: 4 },
    ...item.tags.map((value) => ({ value, weight: 4 })),
    ...titleTerms,
    ...domainTerms,
  ]).slice(0, 12)
}

function normaliseMatchTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function matchesTerm(reportText: string, term: string): boolean {
  const normalised = normaliseMatchTerm(term)
  if (!normalised || normalised.length < 3) return false
  if (normalised.includes(' ')) return reportText.includes(normalised)
  const escaped = normalised.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^| )${escaped}s?(?= |$)`).test(reportText)
}

function dedupeMatchTerms(values: MatchTerm[]): MatchTerm[] {
  const seen = new Set<string>()
  const output: MatchTerm[] = []
  for (const value of values) {
    const normalised = normaliseMatchTerm(value.value)
    if (!normalised || seen.has(normalised)) continue
    seen.add(normalised)
    output.push(value)
  }
  return output
}

function TrendComparisonCard({
  comparison,
  onOpenMatches,
}: {
  comparison: TrendComparison
  onOpenMatches: (comparison: TrendComparison) => void
}) {
  const target = comparison.matchedReportId ? `/community/post/${comparison.matchedReportId}` : '/verify'
  const hasMultipleMatches = comparison.matchedListings.length >= 2
  const tone =
    comparison.level === 'strong'
      ? 'border-risk-low/30 bg-risk-low/10 text-risk-low'
      : comparison.level === 'partial'
        ? 'border-highlight/50 bg-highlight/20 text-card'
        : 'border-ink-faint/20 bg-bg text-ink-soft'
  const bar =
    comparison.level === 'strong'
      ? 'bg-risk-low'
      : comparison.level === 'partial'
        ? 'bg-highlight'
        : 'bg-ink-faint'

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/80">
            {comparison.imageUrl ? (
              <img src={comparison.imageUrl} alt="" className="h-full w-full object-contain p-1.5" loading="lazy" />
            ) : (
              <span className="text-xs font-bold text-ink-soft">Gov</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wide">{comparison.label}</p>
            <span className="mt-1 inline-flex rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold text-brand">
              {comparison.category}
            </span>
            <h4 className="mt-1 line-clamp-2 text-sm font-extrabold text-card">{comparison.title}</h4>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`ml-auto block h-3 w-3 rounded-full ${bar}`} />
          <p className="mt-2 text-xs font-extrabold text-card">{comparison.similarityScore}%</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-soft">{comparison.reason}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
        <div
          className={`h-full ${bar}`}
          style={{ width: `${Math.max(8, comparison.similarityScore)}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {comparison.matchedTerms.length > 0 ? (
          comparison.matchedTerms.slice(0, 4).map((term) => (
            <span key={term} className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold text-card">
              {term}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold text-ink-soft">
            Awaiting local signal
          </span>
        )}
      </div>
      <p className="mt-3 text-xs font-semibold text-ink-soft">
        {comparison.matchedReports} trending Newisance report{comparison.matchedReports === 1 ? '' : 's'} matched.
      </p>
      <p className="mt-2 text-xs font-extrabold text-brand">
        {hasMultipleMatches
          ? 'View matched listings'
          : comparison.matchedReportId
            ? 'Open matched report'
            : 'Submit or verify a report'}
      </p>
    </>
  )

  if (hasMultipleMatches) {
    return (
      <button
        type="button"
        onClick={() => onOpenMatches(comparison)}
        className={`block rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${tone}`}
      >
        {content}
      </button>
    )
  }

  return (
    <Link
      to={target}
      className={`block rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${tone}`}
    >
      {content}
    </Link>
  )
}

function TrendMatchesModal({
  comparison,
  onClose,
}: {
  comparison: TrendComparison
  onClose: () => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-card/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close modal" />
      <article className="relative max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-surface p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-brand">Matched Newisance reports</p>
            <h3 className="mt-1 font-display text-xl font-extrabold text-card">{comparison.title}</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Similarity is scored from weighted exact-word matches. Category and brand terms count more than generic title words.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-bg text-lg font-extrabold text-card"
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          {comparison.matchedListings.map((listing) => (
            <Link
              key={listing.id}
              to={`/community/post/${listing.id}`}
              onClick={onClose}
              className="rounded-2xl bg-bg p-4 transition hover:bg-brand/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-bold text-card">{listing.title}</h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {listing.matchedTerms.slice(0, 5).map((term) => (
                      <span key={term} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-brand">
                        {term}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-extrabold text-white">
                  {listing.score}%
                </span>
              </div>
            </Link>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-xl bg-bg px-4 py-2 text-sm font-bold text-card transition hover:bg-black/5"
        >
          Close
        </button>
      </article>
    </div>
  )
}

function ScamEducationHub({ items }: { items: ScamEducationItem[] | null }) {
  const [selectedEducation, setSelectedEducation] = useState<ScamEducationItem | null>(null)
  return (
    <section className="mt-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-display text-2xl font-extrabold text-card">Scam Education Hub</h2>
          <p className="mt-2 max-w-3xl text-sm text-ink-soft">
            Simple summaries of how common scams approach victims, what pressure tactics they use,
            and the checks to do before money or personal details leave your hands.
          </p>
        </div>
        <a
          href="https://www.scamshield.gov.sg/i-want-protection-from-scams/"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light"
        >
          View ScamShield
        </a>
      </div>

      {items === null ? (
        <p className="mt-6 rounded-2xl border border-black/5 bg-surface p-6 text-sm text-ink-soft">
          Loading ScamShield education content...
        </p>
      ) : items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-black/5 bg-surface p-6 text-sm text-ink-soft">
          ScamShield content could not be loaded right now. Try refreshing the dashboard in a moment.
        </p>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {items.map((item, index) => (
            <ScamEducationCard key={item.source_url} item={item} index={index} onOpen={setSelectedEducation} />
          ))}
        </div>
      )}

      {selectedEducation && (
        <ScamEducationModal item={selectedEducation} onClose={() => setSelectedEducation(null)} />
      )}
    </section>
  )
}

function ScamEducationCard({
  item,
  index,
  onOpen,
}: {
  item: ScamEducationItem
  index: number
  onOpen: (item: ScamEducationItem) => void
}) {
  const theme = scamCardTheme(item.title, index)
  return (
    <article className={`relative overflow-hidden rounded-3xl border bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${theme.border}`}>
      <div className={`absolute inset-x-0 top-0 h-1.5 ${theme.bar}`} />
      <button type="button" onClick={() => onOpen(item)} className="block w-full text-left">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-extrabold ${theme.icon}`}>
              {theme.iconText}
            </span>
            <div>
              <p className={`text-xs font-extrabold uppercase tracking-wide ${theme.label}`}>{theme.kind}</p>
            <h3 className="font-display text-lg font-extrabold text-card">{item.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{item.summary}</p>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${theme.pill}`}>
            Learn
          </span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {item.how_it_works.slice(0, 3).map((step, index) => (
            <div key={step} className={`rounded-2xl p-3 text-center ${theme.stepBg}`}>
              <span className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-xs font-extrabold ${theme.stepIcon}`}>
                {stepIcon(index)}
              </span>
              <p className="mt-2 line-clamp-2 text-xs font-semibold text-card">{shortEducationText(step, 54)}</p>
            </div>
          ))}
        </div>

        <span className={`mt-5 inline-flex rounded-xl px-4 py-2 text-sm font-bold ${theme.button}`}>
          View scam flow
        </span>
      </button>
    </article>
  )
}

type ScamCardTheme = {
  kind: string
  iconText: string
  border: string
  bar: string
  icon: string
  label: string
  pill: string
  stepBg: string
  stepIcon: string
  button: string
}

const SCAM_CARD_THEMES: ScamCardTheme[] = [
  {
    kind: 'Identity trap',
    iconText: 'ID',
    border: 'border-brand/25',
    bar: 'bg-brand',
    icon: 'bg-brand text-white',
    label: 'text-brand',
    pill: 'bg-brand/10 text-brand',
    stepBg: 'bg-brand/10',
    stepIcon: 'bg-brand text-white',
    button: 'bg-brand text-white',
  },
  {
    kind: 'Money lure',
    iconText: '$',
    border: 'border-risk-med/30',
    bar: 'bg-risk-med',
    icon: 'bg-risk-med text-white',
    label: 'text-risk-med',
    pill: 'bg-risk-med/10 text-risk-med',
    stepBg: 'bg-risk-med/10',
    stepIcon: 'bg-risk-med text-white',
    button: 'bg-risk-med text-white',
  },
  {
    kind: 'Work offer',
    iconText: 'JOB',
    border: 'border-secondary/35',
    bar: 'bg-secondary',
    icon: 'bg-secondary text-card',
    label: 'text-secondary',
    pill: 'bg-secondary/15 text-card',
    stepBg: 'bg-secondary/15',
    stepIcon: 'bg-secondary text-card',
    button: 'bg-secondary text-card',
  },
  {
    kind: 'Shopping risk',
    iconText: 'BUY',
    border: 'border-highlight/50',
    bar: 'bg-highlight',
    icon: 'bg-highlight text-card',
    label: 'text-card',
    pill: 'bg-highlight/30 text-card',
    stepBg: 'bg-highlight/25',
    stepIcon: 'bg-highlight text-card',
    button: 'bg-highlight text-card',
  },
  {
    kind: 'Account theft',
    iconText: 'OTP',
    border: 'border-risk-critical/25',
    bar: 'bg-risk-critical',
    icon: 'bg-risk-critical text-white',
    label: 'text-risk-critical',
    pill: 'bg-risk-critical/10 text-risk-critical',
    stepBg: 'bg-risk-critical/10',
    stepIcon: 'bg-risk-critical text-white',
    button: 'bg-risk-critical text-white',
  },
  {
    kind: 'Urgent contact',
    iconText: 'CALL',
    border: 'border-risk-low/35',
    bar: 'bg-risk-low',
    icon: 'bg-risk-low text-card',
    label: 'text-risk-low',
    pill: 'bg-risk-low/15 text-card',
    stepBg: 'bg-risk-low/15',
    stepIcon: 'bg-risk-low text-card',
    button: 'bg-risk-low text-card',
  },
]

function scamCardTheme(title: string, index: number): ScamCardTheme {
  const lowered = title.toLowerCase()
  if (lowered.includes('government') || lowered.includes('impersonation')) return SCAM_CARD_THEMES[0]
  if (lowered.includes('investment') || lowered.includes('loan') || lowered.includes('crypto')) return SCAM_CARD_THEMES[1]
  if (lowered.includes('job')) return SCAM_CARD_THEMES[2]
  if (lowered.includes('commerce') || lowered.includes('shopping')) return SCAM_CARD_THEMES[3]
  if (lowered.includes('phishing') || lowered.includes('bank')) return SCAM_CARD_THEMES[4]
  if (lowered.includes('friend') || lowered.includes('love') || lowered.includes('call')) return SCAM_CARD_THEMES[5]
  return SCAM_CARD_THEMES[index % SCAM_CARD_THEMES.length]
}

function stepIcon(index: number): string {
  return ['1', '2', '3'][index] ?? String(index + 1)
}

function ScamEducationModal({
  item,
  onClose,
}: {
  item: ScamEducationItem
  onClose: () => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-card/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close modal" />
      <article className="relative max-h-[90dvh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-surface p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-brand">Scam flow</p>
            <h3 className="mt-1 font-display text-2xl font-extrabold text-card">{item.title}</h3>
            <p className="mt-2 max-w-3xl text-sm text-ink-soft">{item.summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-bg text-lg font-extrabold text-card"
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          {item.how_it_works.slice(0, 4).map((step, index) => (
            <ScamFlowStep key={step} step={step} index={index} />
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <EducationInfoPanel title="Warning signs" items={item.warning_signs} tone="risk" />
          <EducationInfoPanel title="Protect yourself" items={item.protect_yourself} tone="safe" />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light"
          >
            View ScamShield source
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-bg px-4 py-2 text-sm font-bold text-card transition hover:bg-black/5"
          >
            Close
          </button>
        </div>
      </article>
    </div>
  )
}

function EducationInfoPanel({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: 'risk' | 'safe'
}) {
  const color = tone === 'risk' ? 'text-risk-critical bg-risk-critical/10' : 'text-risk-low bg-risk-low/10'
  return (
    <section className="rounded-3xl bg-bg p-4">
      <h4 className="font-display text-lg font-extrabold text-card">{title}</h4>
      <ul className="mt-3 grid gap-2">
        {items.slice(0, 4).map((item, index) => (
          <li key={item} className="flex gap-2 text-sm text-ink-soft">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${color}`}>
              {tone === 'risk' ? warningIcon(index) : index + 1}
            </span>
            <span>{shortEducationText(item, 150)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ScamFlowStep({ step, index }: { step: string; index: number }) {
  return (
    <details className="group relative rounded-3xl bg-bg p-4">
      <summary className="cursor-pointer list-none">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-lg font-extrabold text-white">
          {flowIcon(index)}
        </span>
        <div className="mt-4 h-2 rounded-full bg-white">
          <div className="h-full rounded-full bg-secondary" style={{ width: `${((index + 1) / 4) * 100}%` }} />
        </div>
        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-brand">Step {index + 1}</p>
        <p className="mt-1 text-sm font-semibold text-card group-open:hidden">
          {shortEducationText(step, 120)}
        </p>
        <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand group-open:hidden">
          View more
        </span>
      </summary>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-card">{step}</p>
      <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand">
        Show less
      </span>
    </details>
  )
}

function shortEducationText(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  const words = cleaned.slice(0, maxLength).split(' ')
  words.pop()
  return `${words.join(' ')}...`
}

function flowIcon(index: number): string {
  return ['1', '2', '3', '4'][index] ?? String(index + 1)
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
