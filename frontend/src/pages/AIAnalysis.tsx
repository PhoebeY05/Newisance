import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import type { AnalysisReport, ConfItem, Metric, SubmissionDetail } from '../types/community'

/**
 * AI Analysis — "AI-Powered Analysis" screen (Figma node 92:2), wired to the
 * deterministic analysis report computed by the AI worker (domain reputation +
 * BeautifulSoup metadata + text heuristics — no AI calls, no rate limits).
 */
export default function AIAnalysis() {
  const { id } = useParams<{ id: string }>()
  const submissionId = Number(id)
  const apiFetch = useApi()

  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [error, setError] = useState('')
  const pollRef = useRef<number | null>(null)

  const fetchDetail = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/community/submissions/${submissionId}`)
      setDetail((await response.json()) as SubmissionDetail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load analysis.')
    }
  }, [apiFetch, submissionId])

  useEffect(() => {
    if (!Number.isFinite(submissionId)) {
      setError('Invalid submission.')
      return
    }
    void fetchDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId])

  // Poll while analysis is still pending.
  useEffect(() => {
    if (detail && detail.status === 'pending') {
      pollRef.current = window.setInterval(() => void fetchDetail(), 5000)
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current)
      }
    }
  }, [detail?.status, fetchDetail])

  const backLink = Number.isFinite(submissionId) ? `/community/post/${submissionId}` : '/community'
  const report = detail?.ai_analysis?.report ?? null

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Link
        to={backLink}
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
      >
        ← Back to Post
      </Link>

      {error && !detail ? (
        <p className="mt-10 text-center text-risk-high">{error}</p>
      ) : !detail ? (
        <p className="mt-10 text-center text-ink-soft">Loading…</p>
      ) : !report ? (
        <PendingState status={detail.status} />
      ) : (
        <Report report={report} />
      )}
    </div>
  )
}

function PendingState({ status }: { status: string }) {
  return (
    <section className="mt-6 rounded-3xl border border-black/5 bg-surface p-10 text-center shadow-sm">
      <h1 className="font-display text-2xl font-extrabold text-card">AI-Powered Analysis</h1>
      {status === 'pending' ? (
        <p className="mt-3 animate-pulse text-ink-soft">⏳ Analysis in progress… this page refreshes automatically.</p>
      ) : (
        <p className="mt-3 text-ink-soft">
          No automated analysis is available for this submission — it&apos;s under community review only.
        </p>
      )}
    </section>
  )
}

function Report({ report }: { report: AnalysisReport }) {
  const score = report.credibility_score
  const scoreTone = score >= 66 ? 'text-risk-low' : score >= 41 ? 'text-risk-med' : 'text-risk-critical'
  const clean = report.misinformation_verdict.startsWith('NO MISINFORMATION')
  // Older reports predate cross_reference_count — fall back to the evidence list.
  const xrefCount = report.cross_reference_count ?? report.evidence.length

  return (
    <>
      {/* Header + overall score */}
      <section className="mt-6 grid gap-6 rounded-3xl bg-card p-8 text-white lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold">AI-Powered Analysis</h1>
            <span className="rounded-full bg-secondary/20 px-3 py-1 text-xs font-bold text-secondary">
              ⚙️ Automated
            </span>
          </div>
          <p className="mt-2 text-white/70">Heuristic analysis and credibility assessment</p>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-white/80">{report.summary}</p>
        </div>
        <div className="text-center">
          <p className={`font-display text-6xl font-extrabold ${scoreTone}`}>{score}%</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-white/60">Credible</p>
        </div>
      </section>

      {report.ai_assessment && (
        <section className="mt-4 rounded-2xl border border-secondary/30 bg-secondary/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-display font-extrabold text-card">
              🤖 {report.ai_assessment.title}
            </p>
            <span className="shrink-0 rounded-full bg-secondary/15 px-2.5 py-0.5 text-xs font-bold text-secondary">
              {report.ai_assessment.confidence}% credible
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-soft">{report.ai_assessment.detail}</p>
        </section>
      )}

      {/* Analysis grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card icon="🔎" title="Source Credibility">
          <div className="space-y-4">
            {report.source_credibility.map((item) => (
              <ConfRow key={item.title} item={item} />
            ))}
          </div>
        </Card>

        <Card icon="✓" title="Fact-Checking">
          <div className="space-y-4">
            {report.fact_checking.map((m) => (
              <Bar key={m.label} metric={m} good="high" />
            ))}
            {report.fact_checking_highlight && (
              <div className="rounded-2xl bg-bg p-4">
                <ConfRow item={report.fact_checking_highlight} compact />
              </div>
            )}
          </div>
        </Card>

        <Card icon="📊" title="Cross-Verification">
          <div className="space-y-4">
            {report.cross_verification.map((item) => (
              <ConfRow key={item.title} item={item} />
            ))}
          </div>
        </Card>

        <Card icon="⚠️" title="Misinformation Check">
          <div className="space-y-4">
            {report.misinformation_metrics.map((m) => (
              <Bar key={m.label} metric={m} good="low" />
            ))}
            <div
              className={`rounded-2xl p-4 text-sm ${
                clean ? 'bg-risk-low/10 text-risk-low' : 'bg-risk-high/10 text-risk-high'
              }`}
            >
              <b>{report.misinformation_verdict}:</b>{' '}
              {clean
                ? 'Language signals look clean — low fabrication, sensationalism, and clickbait.'
                : 'One or more language signals suggest caution; weigh against community votes.'}
            </div>
          </div>
        </Card>
      </div>

      {/* Cross-referenced evidence */}
      <section className="mt-6 rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-xl font-extrabold text-card">
          <span>🔗</span> Cross-Referenced Evidence
          <span className="ml-auto rounded-full bg-brand/10 px-3 py-1 text-sm font-bold text-brand">
            {xrefCount} {xrefCount === 1 ? 'source' : 'sources'}
          </span>
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {report.ai_assessment
            ? 'Independent sources suggested by AI to verify this claim.'
            : 'Sources cited within the submitted content.'}
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {report.evidence.map((card, i) => (
            <div key={`${card.title}-${i}`} className="rounded-2xl border border-black/5 bg-bg p-4">
              <p className="text-2xl">{card.icon}</p>
              <p className="mt-2 font-bold text-card">{card.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{card.detail}</p>
              {card.link_url && (
                <a
                  href={card.link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block break-all text-sm font-semibold text-brand hover:underline"
                >
                  {card.link_label ?? 'Open link'} ↗
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Methodology */}
      <section className="mt-6 rounded-3xl bg-card p-8 text-white shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-xl font-extrabold">
          <span>&lt;/&gt;</span> Verification Methodology
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(report.methodology).map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{label}</p>
              <p className="mt-1 font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function Card({
  icon,
  title,
  count,
  children,
}: {
  icon: string
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-card">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand">{icon}</span>
        {title}
        {count !== undefined && (
          <span className="ml-auto rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand">
            {count} {count === 1 ? 'source' : 'sources'}
          </span>
        )}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function confTone(confidence: number): string {
  if (confidence >= 80) return 'bg-risk-low/15 text-risk-low'
  if (confidence >= 50) return 'bg-risk-med/15 text-risk-med'
  return 'bg-risk-critical/15 text-risk-critical'
}

function ConfRow({ item, compact }: { item: ConfItem; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'border-l-2 border-brand/30 pl-4'}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-card">{item.title}</p>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${confTone(item.confidence)}`}>
          {item.confidence}% confidence
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{item.detail}</p>
    </div>
  )
}

function Bar({ metric, good }: { metric: Metric; good: 'high' | 'low' }) {
  // "high is good" metrics: high score = green; "low is good" (risk): low = green.
  const s = metric.score
  const positive = good === 'high' ? s >= 7 : s <= 3
  const middling = good === 'high' ? s >= 4 : s <= 6
  const color = positive ? 'bg-risk-low' : middling ? 'bg-risk-med' : 'bg-risk-critical'
  const textColor = positive ? 'text-risk-low' : middling ? 'text-risk-med' : 'text-risk-critical'
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-card">{metric.label}</span>
        <span className={`font-bold ${textColor}`}>{metric.score.toFixed(1)}/10</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${metric.score * 10}%` }} />
      </div>
    </div>
  )
}
