import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { linkOutline, refreshOutline } from 'ionicons/icons'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../context/AuthContext'
import type { AppealOut, SubmissionFeed, SubmissionOut } from '../types/community'
import {
  CATEGORIES,
  MediaThumb,
  isMediaPath,
  parseCaption,
  previewContent,
  timeAgo,
} from '../lib/community'

/**
 * Community - "Community Verification" feed (Figma node 89:594), wired to the
 * Phase 5 hub. Loads real submissions from the community service, shows a
 * credibility-weighted fake-likelihood badge + vote count on each card, and
 * links each one to its full verification page (/community/post/:id).
 */
export default function Community() {
  const apiFetch = useApi()
  const { loading: authLoading } = useAuth()
  const [items, setItems] = useState<SubmissionOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [appealTarget, setAppealTarget] = useState<SubmissionOut | null>(null)
  const [appealBusy, setAppealBusy] = useState(false)

  const loadFeed = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/community/submissions?page=1&page_size=50')
      const feed = (await response.json()) as SubmissionFeed
      setItems(feed.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the feed.')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (authLoading) return
    void loadFeed()
  }, [authLoading, loadFeed])

  const toggleCategory = (category: string) => {
    const updated = new Set(selectedCategories)
    if (updated.has(category)) {
      updated.delete(category)
    } else {
      updated.add(category)
    }
    setSelectedCategories(updated)
  }

  const clearFilters = () => {
    setSelectedCategories(new Set())
  }

  async function submitAppeal() {
    if (!appealTarget) return
    setAppealBusy(true)
    try {
      const response = await apiFetch(`/api/community/submissions/${appealTarget.id}/appeal`, { method: 'POST' })
      const appeal = (await response.json()) as AppealOut
      setItems((current) =>
        current.map((item) =>
          item.id === appeal.submission_id
            ? { ...item, appeal_status: appeal.status, can_appeal: false }
            : item,
        ),
      )
      setAppealTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit appeal.')
    } finally {
      setAppealBusy(false)
    }
  }

  // Filter items by selected categories
  const filteredItems =
    selectedCategories.size === 0
      ? items
      : items.filter((item) => {
        const meta = parseCaption(item.caption)
        return meta.category && selectedCategories.has(meta.category)
      })

  const pending = items.filter((item) => item.status === 'pending').length

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#f6f7f8] px-3 py-4 sm:px-6 sm:py-12 xl:px-8">
      <div className="mx-auto w-full max-w-[1180px] min-w-0 xl:max-w-[1280px]">
        <header className="rounded-2xl bg-card px-4 py-5 text-white shadow-sm sm:rounded-3xl sm:px-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-wide text-secondary sm:text-xs">Live community queue</p>
            <h1 className="mt-1.5 font-display text-[1.45rem] font-extrabold leading-tight sm:mt-2 sm:text-5xl">Community Verification</h1>
            <p className="mt-2 max-w-[24rem] text-xs leading-5 text-white/70 sm:mt-3 sm:text-lg">
              Help verify suspicious content submitted by the community
            </p>
          </div>
        </header>

        <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-2xl border border-black/5 bg-surface p-2.5 shadow-sm sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <button
              type="button"
              onClick={() => void loadFeed()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-bg px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/5 sm:flex-none sm:px-4 sm:text-sm"
            >
              <IonIcon icon={refreshOutline} />
              Refresh
            </button>
            <Link
              to="/verify"
              className="rounded-lg bg-brand px-3 py-2 text-center text-xs font-bold text-white transition hover:bg-brand-light sm:flex-none sm:px-4 sm:text-sm"
            >
              + Submit Content
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:gap-3">
            <Counter value={String(pending)} label="Pending" />
            <Counter value={String(filteredItems.length)} label="Submissions" />
          </div>
        </div>

        <div className="mt-3 grid w-full min-w-0 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <aside className="w-full min-w-0 overflow-hidden rounded border border-[#ccc] bg-white p-3 sm:p-4 lg:sticky lg:top-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[#1a1a1b]">Filter by category</h3>
              {selectedCategories.size > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-semibold text-[#0079d3] transition hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-[#787c7e]">
              Showing {filteredItems.length} of {items.length} submissions
            </p>
            <div className="mt-3 flex w-full min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 sm:mt-4 sm:block sm:max-h-[22rem] sm:space-y-2 sm:overflow-auto sm:pb-0 sm:pr-1 lg:max-h-[calc(100vh-12rem)]">
              {CATEGORIES.map((category) => (
                <label
                  key={category}
                  className="flex max-w-[78vw] shrink-0 cursor-pointer items-center gap-2 rounded-full border border-[#edeff1] px-3 py-1.5 text-xs text-[#1a1a1b] transition hover:bg-[#f6f7f8] sm:max-w-none sm:items-start sm:rounded sm:border-0 sm:px-2 sm:text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.has(category)}
                    onChange={() => toggleCategory(category)}
                    className="h-3.5 w-3.5 rounded border-[#878a8c] accent-[#0079d3] sm:mt-0.5 sm:h-4 sm:w-4"
                  />
                  <span className="truncate leading-5 sm:whitespace-normal">{category}</span>
                </label>
              ))}
            </div>
          </aside>

          <main className="w-full min-w-0 max-w-full">
            {loading ? (
              <p className="mt-12 text-center text-ink-soft">Loading submissions...</p>
            ) : error ? (
              <p className="mt-12 text-center text-risk-high">{error}</p>
            ) : filteredItems.length === 0 ? (
              <div className="mt-12 text-center">
                <p className="text-ink-soft">
                  {selectedCategories.size > 0 ? 'No submissions in selected categories.' : 'No submissions yet. Be the first to flag something suspicious.'}
                </p>
                {selectedCategories.size === 0 && (
                  <Link
                    to="/verify"
                    className="mt-4 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light"
                  >
                    Submit Content
                  </Link>
                )}
              </div>
            ) : (
              <div className="w-full min-w-0 space-y-2.5 sm:space-y-3">
                {filteredItems.map((item) => (
                  <FeedCard key={item.id} submission={item} onAppeal={() => setAppealTarget(item)} />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
      {appealTarget && (
        <AppealModal
          busy={appealBusy}
          onCancel={() => setAppealTarget(null)}
          onConfirm={() => void submitAppeal()}
        />
      )}
    </div>
  )
}

function FeedCard({ submission, onAppeal }: { submission: SubmissionOut; onAppeal: () => void }) {
  const meta = parseCaption(submission.caption)
  const realPct = submission.fake_likelihood == null ? 50 : Math.round((1 - submission.fake_likelihood) * 100)
  const fakePct = submission.fake_likelihood == null ? 50 : 100 - realPct
  const title = meta.reason || previewContent(submission)
  const source = sourceDomain(meta.source || submission.content_url)
  const voteText = submission.vote_count === 0 ? 'No votes yet' : `${submission.vote_count} ${submission.vote_count === 1 ? 'vote' : 'votes'}`
  const commentText = `${submission.comment_count} ${submission.comment_count === 1 ? 'comment' : 'comments'}`
  return (
    <article className="w-full min-w-0 overflow-hidden rounded border border-[#ccc] bg-white transition hover:border-[#898989] hover:shadow-sm">
      <div className="min-w-0 p-3 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate rounded-full bg-[#e6f3ff] px-2.5 py-1 text-[11px] font-semibold text-[#0079d3] sm:text-xs">
            {meta.category || submission.content_type}
          </span>
          <span className="shrink-0 text-xs text-[#787c7e]">{timeAgo(submission.created_at)}</span>
        </div>

        <Link
          to={`/community/post/${submission.id}`}
          className="mt-2 block min-w-0 text-[14px] font-semibold leading-5 text-[#1a1a1b] hover:text-[#0079d3] sm:mt-3 sm:text-[16px] sm:leading-6"
        >
          <span className="line-clamp-2">{title}</span>
        </Link>

        <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-[11px] text-[#787c7e] sm:text-xs">
          <IonIcon icon={linkOutline} />
          <span className="truncate">{source}</span>
        </p>

        {isMediaPath(submission.content_url) && (
          <Link
            to={`/community/post/${submission.id}`}
            className="mt-3 block h-32 w-full min-w-0 overflow-hidden rounded border border-[#edeff1] bg-[#f6f7f8] sm:h-48 lg:h-56 xl:h-64"
          >
            <MediaThumb contentUrl={submission.content_url} fit="contain" />
          </Link>
        )}

        {!isMediaPath(submission.content_url) && title !== previewContent(submission) && (
          <Link
            to={`/community/post/${submission.id}`}
            className="mt-3 block min-w-0 rounded border border-[#edeff1] bg-[#f6f7f8] p-2.5 text-xs leading-5 text-[#1a1a1b] sm:p-3 sm:text-sm sm:leading-6"
          >
            <span className="line-clamp-3 break-words">{previewContent(submission)}</span>
          </Link>
        )}

        <div className="mt-3 flex min-w-0 flex-col gap-2 border-t border-[#edeff1] pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <Link
            to={`/community/post/${submission.id}`}
            className="w-fit shrink-0 rounded px-1.5 py-1 text-[11px] font-semibold text-[#787c7e] transition hover:bg-[#f6f7f8] hover:text-[#1a1a1b] sm:px-2 sm:text-xs"
          >
            {voteText} · {commentText}
          </Link>

          <VerdictSplitBar realPct={realPct} fakePct={fakePct} hasVotes={submission.vote_count > 0} />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {submission.can_appeal && (
              <button
                type="button"
                onClick={onAppeal}
                className="rounded border border-[#ff4500]/30 bg-[#fff3ef] px-3 py-1.5 text-xs font-bold text-[#ff4500] transition hover:bg-[#ffe5dc]"
              >
                Appeal Verdict
              </button>
            )}
            <AppealOutcome status={submission.appeal_status} />
          </div>
          <AiVerdictBadge verdict={submission.ai_verdict} />
        </div>
      </div>
    </article>
  )
}

function AppealOutcome({ status }: { status: SubmissionOut['appeal_status'] }) {
  if (!status) return null

  if (status === 'pending') {
    return (
      <p className="rounded-full bg-[#f6f7f8] px-3 py-1.5 text-xs font-semibold text-[#787c7e]">
        Appeal submitted · pending review
      </p>
    )
  }

  if (status === 'upheld') {
    return (
      <p className="rounded-full bg-[#fff3ef] px-3 py-1.5 text-xs font-bold text-[#ff4500]">
        Appeal reviewed · verdict upheld
      </p>
    )
  }

  if (status === 'rejected') {
    return (
      <p className="rounded-full bg-[#e8f5e9] px-3 py-1.5 text-xs font-bold text-[#2e7d32]">
        Appeal reviewed · verdict overturned
      </p>
    )
  }

  return (
    <p className="rounded-full bg-[#f6f7f8] px-3 py-1.5 text-xs font-semibold text-[#787c7e]">
      Appeal reviewed
    </p>
  )
}

function AiVerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) {
    return (
      <span className="text-right text-[11px] font-medium text-[#787c7e]">
        AI verdict hidden until you vote
      </span>
    )
  }

  return (
    <span className="rounded-full border border-[#0079d3]/20 bg-[#e6f3ff] px-2.5 py-1 text-[11px] font-bold uppercase text-[#0079d3]">
      AI verdict: {verdict.replace(/_/g, ' ')}
    </span>
  )
}

function sourceDomain(value: string): string {
  if (!value || isMediaPath(value)) return 'community upload'
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value.length > 42 ? `${value.slice(0, 42)}...` : value
  }
}

function VerdictSplitBar({ realPct, fakePct, hasVotes }: { realPct: number; fakePct: number; hasVotes: boolean }) {
  const realWidth = hasVotes ? realPct : 0
  const fakeWidth = hasVotes ? fakePct : 0

  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      <div
        className="flex h-2.5 w-20 shrink-0 overflow-hidden rounded-full bg-[#edeff1] sm:h-3 sm:w-[120px]"
        aria-label={hasVotes ? `${realPct}% Real, ${fakePct}% Fake` : 'No votes yet'}
      >
        {realWidth > 0 && (
          <div
            className="bg-[#2e7d32]"
            style={{ width: `${realWidth}%` }}
          />
        )}
        {fakeWidth > 0 && (
          <div
            className="bg-[#d32f2f]"
            style={{ width: `${fakeWidth}%` }}
          />
        )}
      </div>
      {hasVotes && (
        <span className="min-w-0 truncate text-[10px] text-[#787c7e] sm:text-[11px]">
          {realPct}% Real · {fakePct}% Fake — based on community votes only
        </span>
      )}
    </div>
  )
}
function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2 text-center sm:px-4">
      <p className="font-display text-sm font-extrabold text-brand sm:text-lg">{value}</p>
      <p className="text-[11px] text-ink-soft sm:text-xs">{label}</p>
    </div>
  )
}

function IonIcon({ icon }: { icon: string }) {
  const svg = decodeURIComponent(icon.replace('data:image/svg+xml;utf8,', ''))
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-current [&_.ionicon-fill-none]:fill-none [&_.ionicon-stroke-width]:[stroke-width:32px] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:fill-current [&_svg]:stroke-current"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function AppealModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-[#1a1a1b]">Appeal this verdict?</h2>
        <p className="mt-2 text-sm leading-6 text-[#787c7e]">
          This will send the post to an admin for manual review. You can only appeal once per submission.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-bold text-[#1a1a1b] transition hover:bg-[#f6f7f8] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light disabled:opacity-60"
          >
            Submit Appeal
          </button>
        </div>
      </div>
    </div>
  )
}


