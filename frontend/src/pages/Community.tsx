import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import type { SubmissionFeed, SubmissionOut } from '../types/community'
import {
  CATEGORIES,
  ImpactStars,
  MediaThumb,
  StatusPill,
  contentEmoji,
  formatLikelihood,
  isMediaPath,
  parseCaption,
  previewContent,
  riskFor,
  riskStyle,
  timeAgo,
} from '../lib/community'

/**
 * Community — "Community Verification" feed (Figma node 89:594), wired to the
 * Phase 5 hub. Loads real submissions from the community service, shows a
 * credibility-weighted fake-likelihood badge + vote count on each card, and
 * links each one to its full verification page (/community/post/:id).
 */
export default function Community() {
  const apiFetch = useApi()
  const [items, setItems] = useState<SubmissionOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())

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
    void loadFeed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="rounded-3xl bg-card px-5 py-8 text-white shadow-sm sm:px-8 sm:py-10">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-wide text-secondary">Live community queue</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold sm:text-5xl">Community Verification</h1>
          <p className="mt-3 text-sm text-white/70 sm:text-lg">
          Help verify suspicious content submitted by the community
          </p>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-black/5 bg-surface p-4 shadow-sm sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:p-5">
        <div className="flex gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => void loadFeed()}
            className="flex-1 rounded-lg border border-black/10 bg-bg px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/5 sm:flex-none"
          >
            ↻ Refresh
          </button>
          <Link
            to="/verify"
            className="flex-1 rounded-lg bg-brand px-4 py-2 text-center text-sm font-bold text-white transition hover:bg-brand-light sm:flex-none"
          >
            + Submit Content
          </Link>
        </div>

        <div className="flex gap-2 sm:ml-auto sm:gap-3">
          <Counter value={String(pending)} label="Pending" />
          <Counter value={String(filteredItems.length)} label="Submissions" />
        </div>
      </div>

      {/* Category Filter — compact wrapping chips (was a tall full-width grid on mobile) */}
      <div className="mt-4 rounded-2xl border border-black/5 bg-surface p-4 shadow-sm sm:mt-6 sm:p-5">
        <div className="mb-3 flex items-center justify-between sm:mb-4">
          <h3 className="text-sm font-semibold text-card sm:text-base">Filter by Category</h3>
          {selectedCategories.size > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-brand transition hover:text-brand-light"
            >
              Clear All
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => toggleCategory(category)}
              aria-pressed={selectedCategories.has(category)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                selectedCategories.has(category)
                  ? 'bg-card text-white'
                  : 'border border-black/10 bg-bg text-card hover:border-brand/30 hover:bg-brand/5'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
        {selectedCategories.size > 0 && (
          <p className="mt-3 text-xs text-ink-soft">
            Showing {filteredItems.length} of {items.length} submissions
          </p>
        )}
      </div>

      {loading ? (
        <p className="mt-12 text-center text-ink-soft">Loading submissions…</p>
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
        <div className="mt-6 grid gap-4 sm:mt-8 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => (
            <FeedCard key={item.id} submission={item} />
          ))}
        </div>
      )}
    </div>
  )
}

function FeedCard({ submission }: { submission: SubmissionOut }) {
  const risk = riskFor(submission.fake_likelihood)
  const meta = parseCaption(submission.caption)
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-brand/20 hover:shadow-lg">
      <div className="flex items-center justify-between border-b border-black/5 bg-bg/70 px-5 py-3">
        <span className="text-xs font-semibold text-ink-soft">{timeAgo(submission.created_at)}</span>
        <StatusPill status={submission.status} />
      </div>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold uppercase text-brand">
            {submission.content_type}
          </span>
          {meta.category && (
            <span className="rounded-full bg-secondary/15 px-2.5 py-0.5 text-xs font-bold text-secondary">
              {meta.category}
            </span>
          )}
          {meta.impactLevel && (
            <span className="rounded-full bg-highlight/25 px-2.5 py-0.5 text-xs font-bold text-ink">
              {meta.impactLevel} Impact
            </span>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${riskStyle[risk.tone]}`}>
          {risk.label}
        </span>
      </div>

      {/* Fixed-height content area so image and text cards look uniform. */}
      <div className="mt-4 rounded-2xl border border-black/5 bg-bg p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">
          {contentEmoji(submission.content_type)} Submitted content
        </p>
        <div className="mt-2 h-44 overflow-hidden rounded-xl bg-surface">
          {isMediaPath(submission.content_url) ? (
            <MediaThumb contentUrl={submission.content_url} />
          ) : (
            <p className="line-clamp-6 break-words p-3 font-medium text-card">{previewContent(submission)}</p>
          )}
        </div>
      </div>

      <div className="mt-4 min-h-[2.5rem]">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Why suspicious</p>
        <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{meta.reason || '—'}</p>
      </div>

      <p className="mt-3 truncate text-xs text-ink-soft">
        <span className="font-semibold text-card">Source:</span> {meta.source || '—'}
      </p>

      <div className="mt-auto flex items-center justify-between pt-4 text-sm">
        <span className="text-xs font-semibold text-ink-faint">Community impact</span>
        <ImpactStars value={submission.weighted_impact} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-4">
        <div className="flex gap-4 text-sm text-ink-soft">
          <span>
            <b className="text-card">{submission.vote_count}</b> votes
          </span>
          <span>
            <b className="text-card">{formatLikelihood(submission.fake_likelihood)}</b> fake
          </span>
        </div>
        <Link
          to={`/community/post/${submission.id}`}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light"
        >
          Verify This
        </Link>
      </div>
      </div>
    </article>
  )
}

function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-bg px-4 py-2 text-center">
      <p className="font-display text-lg font-extrabold text-brand">{value}</p>
      <p className="text-xs text-ink-soft">{label}</p>
    </div>
  )
}
