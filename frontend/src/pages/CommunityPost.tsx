import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../context/AuthContext'
import type { CommentOut, ContentType, SubmissionDetail, Verdict } from '../types/community'
import {
  CATEGORIES,
  IMPACT_LEVELS,
  ImpactStars,
  StatusPill,
  buildCaption,
  contentEmoji,
  formatLikelihood,
  isMediaPath,
  mediaKind,
  mediaUrl,
  parseCaption,
  previewContent,
  riskFor,
  riskStyle,
  timeAgo,
} from '../lib/community'

/**
 * Community Post Details (Figma node 89:659), wired to the Phase 5 hub. Left
 * column: the submitted post, "Why Suspicious?" and meta + AI analysis. Right
 * column: your verification controls (weighted Real/Fake vote), live community
 * consensus, and community fact-checks. Owners/admins can delete the post.
 */
export default function CommunityPost() {
  const { id } = useParams<{ id: string }>()
  const submissionId = Number(id)
  const apiFetch = useApi()
  const { token, user, loginAsGuest } = useAuth()
  const voteWeight = user?.is_guest ? 0.1 : Math.min((user?.credibility_score ?? 50) / 100, 1)
  const navigate = useNavigate()

  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [error, setError] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [impact, setImpact] = useState(4)
  const [voting, setVoting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const pollRef = useRef<number | null>(null)

  const fetchDetail = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/community/submissions/${submissionId}`)
      const body = (await response.json()) as SubmissionDetail
      setDetail(body)
      if (body.your_vote) {
        setVerdict(body.your_vote.verdict)
        setImpact(body.your_vote.impact_score)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this submission.')
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

  // Poll every 5s while AI analysis is still pending (Phase 6 worker fills it in).
  useEffect(() => {
    if (detail?.status === 'pending') {
      pollRef.current = window.setInterval(() => void fetchDetail(), 5000)
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current)
      }
    }
  }, [detail?.status, fetchDetail])

  async function submitVote() {
    if (!verdict || !detail) return
    setVoting(true)
    setError('')
    try {
      await apiFetch(`/api/community/submissions/${submissionId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ verdict, impact_score: impact }),
      })
      await fetchDetail() // re-sync weighted consensus + counts
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vote failed.')
    } finally {
      setVoting(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this submission permanently? This cannot be undone.')) return
    setDeleting(true)
    setError('')
    try {
      await apiFetch(`/api/community/submissions/${submissionId}`, { method: 'DELETE' })
      navigate('/community')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
      setDeleting(false)
    }
  }

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-risk-high">{error}</p>
        <Link to="/community" className="mt-4 inline-block font-semibold text-brand hover:underline">
          ← Back to Feed
        </Link>
      </div>
    )
  }

  if (!detail) {
    return <p className="mx-auto max-w-7xl px-6 py-16 text-center text-ink-soft">Loading…</p>
  }

  // caption packs the "why suspicious" note + meta chips joined by " • ".
  const captionParts = detail.caption ? detail.caption.split(' • ') : []
  const whySuspicious = captionParts[0] ?? ''
  const metaChips = captionParts.slice(1)
  const risk = riskFor(detail.fake_likelihood)
  const hasVoted = Boolean(detail.your_vote)
  const isAdmin = Boolean(user?.is_admin)
  const canSeeAi = isAdmin || hasVoted

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Link
          to="/community"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
        >
          ← Back to Feed
        </Link>
        <div className="flex items-center gap-2">
          {detail.can_edit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/10"
            >
              ✏️ Edit Post
            </button>
          )}
          {detail.can_delete && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-xl border border-risk-critical/30 bg-risk-critical/5 px-4 py-2 text-sm font-semibold text-risk-critical transition hover:bg-risk-critical/10 disabled:opacity-60"
            >
              🗑 {deleting ? 'Deleting…' : 'Delete Post'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{error}</p>}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* Left — post details (or edit form) */}
        <div className="space-y-6">
          {editing ? (
            <EditForm
              detail={detail}
              onCancel={() => setEditing(false)}
              onSaved={(updated) => {
                setDetail(updated)
                setEditing(false)
              }}
            />
          ) : (
          <>
          <article className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold uppercase text-brand">
                  {detail.content_type}
                </span>
                <p className="mt-1 text-xs text-ink-soft">Submitted {timeAgo(detail.created_at)}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${riskStyle[risk.tone]}`}>
                {risk.label}
              </span>
            </div>

            <h1 className="mt-4 font-display text-2xl font-extrabold text-card">
              {whySuspicious || previewContent(detail)}
            </h1>

            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary/15 text-sm font-bold text-secondary">
                {initials(detail.submitter)}
              </span>
              <div>
                <p className="text-sm font-semibold text-card">{detail.submitter ?? 'Anonymous'}</p>
                <p className="text-xs text-ink-soft">Submitted by</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl bg-bg p-4">
              <p className="text-sm font-semibold text-ink-soft">
                {contentEmoji(detail.content_type)} Submitted content
              </p>
              {isMediaPath(detail.content_url) ? (
                <SubmittedMedia contentUrl={detail.content_url} />
              ) : detail.content_type === 'url' ? (
                <a
                  href={detail.content_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-words font-medium text-brand hover:underline"
                >
                  {detail.content_url}
                </a>
              ) : (
                <p className="mt-2 break-words font-medium text-card">{previewContent(detail)}</p>
              )}
            </div>
          </article>

          <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl font-extrabold text-card">Why Suspicious?</h2>
            <p className="mt-3 rounded-2xl border border-black/5 bg-bg p-4 text-sm leading-relaxed text-ink-soft">
              {whySuspicious || 'No description provided.'}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {metaChips.map((chip) => {
                const [label, ...rest] = chip.split(':')
                return <Meta key={chip} label={label.trim()} value={rest.join(':').trim() || '—'} />
              })}
              <Meta
                label="AI Analysis verdict"
                value={
                  !canSeeAi ? (
                    'Hidden until you vote'
                  ) : detail.status === 'pending' ? (
                    'Pending…'
                  ) : detail.ai_analysis?.verdict ? (
                    <Link to={`/ai-analysis/${submissionId}`} className="font-semibold text-brand hover:underline">
                      {detail.ai_analysis.verdict} (See more)
                    </Link>
                  ) : (
                    'Community only'
                  )
                }
              />
            </div>
          </section>

          <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-extrabold text-card">AI Analysis</h2>
              {canSeeAi && detail.ai_analysis?.report && (
                <Link
                  to={`/ai-analysis/${submissionId}`}
                  className="shrink-0 rounded-xl bg-brand px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-light"
                >
                  View full analysis →
                </Link>
              )}
            </div>
            {!canSeeAi ? (
              <div className="mt-3 rounded-2xl border border-black/5 bg-bg p-4">
                <p className="text-sm font-semibold text-card">AI verdict hidden</p>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  The AI verdict and analysis will be shown after you submit your own final verdict.
                </p>
              </div>
            ) : detail.status === 'pending' ? (
              <p className="mt-3 animate-pulse text-sm text-ink-soft">⏳ AI analysis in progress…</p>
            ) : detail.ai_analysis ? (
              <div className="mt-3 space-y-3">
                {detail.ai_analysis.report && (
                  <p className="text-sm font-semibold text-card">
                    Credibility:{' '}
                    <span className="text-brand">{detail.ai_analysis.report.credibility_score}%</span>
                  </p>
                )}
                <p className="text-sm font-semibold text-card">
                  Verdict: <span className="text-brand">{detail.ai_analysis.verdict ?? 'n/a'}</span>
                  {detail.ai_analysis.confidence != null &&
                    ` · ${Math.round(detail.ai_analysis.confidence * 100)}% confidence`}
                </p>
                {detail.ai_analysis.explanation && (
                  <p className="rounded-2xl bg-bg p-4 text-sm text-ink-soft">{detail.ai_analysis.explanation}</p>
                )}
                {detail.ai_analysis.signals.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
                    {detail.ai_analysis.signals.map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                No AI analysis available — this submission is under community review only.
              </p>
            )}
          </section>
          </>
          )}
        </div>

        {/* Right — verification + community */}
        <div className="space-y-6">
          <section className="rounded-3xl bg-card p-6 text-white shadow-sm">
            <h2 className="font-display text-xl font-extrabold">{isAdmin ? 'Admin Review' : 'Your Verdict'}</h2>

            {isAdmin ? (
              <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-white/80 ring-1 ring-white/10">
                <p className="font-bold text-secondary">Community voting disabled</p>
                <p className="mt-1 text-xs leading-5 text-white/65">
                  Admin accounts can view AI analysis immediately and edit or delete submissions, but do not cast
                  credibility-weighted community votes.
                </p>
              </div>
            ) : !token ? (
              <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-white/80 ring-1 ring-white/10">
                <p>Sign in to cast a weighted vote.</p>
                <div className="mt-3 flex gap-2">
                  <Link
                    to="/login"
                    className="rounded-xl bg-secondary px-4 py-2 text-sm font-bold text-card transition hover:opacity-90"
                  >
                    Log in
                  </Link>
                  <button
                    type="button"
                    onClick={() => void loginAsGuest()}
                    className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  >
                    Continue as guest
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!hasVoted) setVerdict('fake')
                    }}
                    disabled={hasVoted}
                    aria-pressed={verdict === 'fake'}
                    className={`rounded-xl py-3 font-extrabold transition ${
                      verdict === 'fake'
                        ? 'bg-risk-critical text-white ring-2 ring-white/40'
                        : 'bg-risk-critical/80 text-white hover:opacity-90'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    FAKE
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!hasVoted) setVerdict('real')
                    }}
                    disabled={hasVoted}
                    aria-pressed={verdict === 'real'}
                    className={`rounded-xl py-3 font-extrabold transition ${
                      verdict === 'real'
                        ? 'bg-risk-low text-white ring-2 ring-white/40'
                        : 'bg-risk-low/80 text-white hover:opacity-90'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    REAL
                  </button>
                </div>

                {hasVoted ? (
                  <div className="mt-4 rounded-2xl border border-secondary/30 bg-secondary/10 p-4 text-sm text-white/80">
                    <p className="font-bold text-secondary">Vote locked</p>
                    <p className="mt-1 text-xs leading-5 text-white/65">
                      You voted <b className="uppercase text-white">{detail.your_vote?.verdict}</b> with impact{' '}
                      <b className="text-white">{detail.your_vote?.impact_score}</b>. Each account can verify a
                      submission once, so this verdict cannot be changed.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                    <p className="font-bold text-white">One vote only</p>
                    <p className="mt-1 text-xs leading-5 text-white/60">
                      Choose carefully. Your Real/Fake verdict is final once submitted and cannot be edited later.
                      The AI verdict will stay hidden until you submit your own verdict.
                    </p>
                  </div>
                )}

                <label className="mt-4 block text-sm">
                  <span className="text-white/70">
                    The <strong>impact</strong> you think this info will cause: <b className="text-secondary">{impact}</b> / 5
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={impact}
                    onChange={(event) => setImpact(Number(event.target.value))}
                    disabled={hasVoted}
                    className="mt-2 w-full accent-secondary"
                    aria-label="Impact score from 1 to 5"
                  />
                </label>

                <p className="mt-4 text-center text-xs text-white/60">
                  Your vote weight:{' '}
                  <b className="text-secondary">{voteWeight.toFixed(2)}×</b>
                  {user?.is_guest ? ' (guest)' : ` · ${user?.tier ?? ''}`}
                </p>

                <button
                  type="button"
                  disabled={!verdict || voting || hasVoted}
                  onClick={() => void submitVote()}
                  className="mt-2 w-full rounded-xl bg-secondary py-3 text-sm font-bold text-card transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {hasVoted ? 'Vote Locked' : voting ? 'Submitting...' : 'Submit Final Vote'}
                </button>
              </>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/5 p-3 text-center ring-1 ring-white/10">
                <p className="font-display text-2xl font-extrabold text-risk-critical">{detail.fake_votes}</p>
                <p className="text-xs text-white/60">Say FAKE</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3 text-center ring-1 ring-white/10">
                <p className="font-display text-2xl font-extrabold text-risk-low">{detail.real_votes}</p>
                <p className="text-xs text-white/60">Say REAL</p>
              </div>
            </div>

            <p className="mt-4 rounded-2xl bg-white/5 p-3 text-center text-sm ring-1 ring-white/10">
              Community Consensus: {formatLikelihood(detail.fake_likelihood)} Likely Fake ·{' '}
              <ImpactStars value={detail.weighted_impact} inline />
            </p>
            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-white/60">
              <StatusPill status={detail.status} /> {detail.vote_count} total votes
            </div>
          </section>

          <CommentSection submissionId={submissionId} />
        </div>
      </div>
    </div>
  )
}

function SubmittedMedia({ contentUrl }: { contentUrl: string }) {
  const [failed, setFailed] = useState(false)
  const kind = mediaKind(contentUrl)
  const src = mediaUrl(contentUrl)

  if (failed || kind === null) {
    return (
      <p className="mt-2 text-sm text-ink-soft">
        {kind === null ? 'Unsupported media format.' : 'Media file unavailable.'}
      </p>
    )
  }

  if (kind === 'video') {
    return (
      <video
        src={src}
        controls
        className="mt-3 max-h-[28rem] w-full rounded-xl bg-black"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <img
      src={src}
      alt="Submitted media"
      className="mt-3 max-h-[28rem] w-full rounded-xl bg-bg object-contain"
      onError={() => setFailed(true)}
    />
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'text', label: '📝 Text' },
  { value: 'url', label: '🔗 URL' },
  { value: 'image', label: '🖼️ Image' },
]

function EditForm({
  detail,
  onCancel,
  onSaved,
}: {
  detail: SubmissionDetail
  onCancel: () => void
  onSaved: (updated: SubmissionDetail) => void
}) {
  const apiFetch = useApi()
  const parsed = parseCaption(detail.caption)
  const [contentType, setContentType] = useState<ContentType>(
    (detail.content_type as ContentType) ?? 'text',
  )
  const [content, setContent] = useState(detail.content_type === 'image' ? '' : detail.content_url)
  const [file, setFile] = useState<File | null>(null)
  const [reason, setReason] = useState(parsed.reason)
  const [category, setCategory] = useState(parsed.category)
  const [impactLevel, setImpactLevel] = useState(parsed.impactLevel)
  const [source, setSource] = useState(parsed.source)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // True when keeping the original image and not replacing it.
  const keepingExistingImage = contentType === 'image' && detail.content_type === 'image'

  async function save() {
    if (!reason.trim() || !category || !impactLevel) {
      setErr('Please fill in why it is suspicious, plus category and impact level.')
      return
    }

    setSaving(true)
    setErr('')
    try {
      const body: Record<string, unknown> = {
        content_type: contentType,
        caption: buildCaption({ reason, category, impactLevel, source }),
      }

      if (contentType === 'image') {
        if (file) {
          body.content = await fileToBase64(file)
        } else if (!keepingExistingImage) {
          setErr('Choose an image to upload.')
          setSaving(false)
          return
        }
      } else {
        if (!content.trim()) {
          setErr('Content cannot be empty.')
          setSaving(false)
          return
        }
        body.content = content.trim()
      }

      const response = await apiFetch(`/api/community/submissions/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      onSaved((await response.json()) as SubmissionDetail)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.')
      setSaving(false)
    }
  }

  const inputClass =
    'mt-1.5 w-full rounded-xl border border-black/10 bg-bg px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <h2 className="font-display text-xl font-extrabold text-card">Edit Submission</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Changing the content will reset AI analysis and re-queue it.
      </p>

      {err && <p className="mt-4 rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{err}</p>}

      <div className="mt-5 space-y-5">
        <div>
          <span className="text-sm font-semibold text-card">Content type</span>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {CONTENT_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setContentType(option.value)
                  setFile(null)
                }}
                aria-pressed={contentType === option.value}
                className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
                  contentType === option.value
                    ? 'border-brand bg-brand/5 text-brand ring-2 ring-brand/15'
                    : 'border-black/10 text-ink hover:border-brand/40'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-card">
            {contentType === 'image' ? 'Replace image' : contentType === 'url' ? 'URL / Link' : 'Text / Caption'}
          </span>
          {contentType === 'image' ? (
            <div className="mt-1.5">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
              {keepingExistingImage && !file && (
                <p className="mt-1.5 text-xs text-ink-faint">
                  Keeping the current image unless you choose a new one.
                </p>
              )}
            </div>
          ) : contentType === 'url' ? (
            <input
              type="url"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="https://example.com/article"
              className={inputClass}
            />
          ) : (
            <textarea
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste the suspicious text…"
              className={`${inputClass} resize-none`}
            />
          )}
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-card">What makes you suspicious?*</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why you think this content might be false or misleading…"
            className={`${inputClass} resize-none`}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-card">Category*</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="" disabled>
                Select category…
              </option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-card">Impact Level*</span>
            <select
              value={impactLevel}
              onChange={(event) => setImpactLevel(event.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="" disabled>
                How harmful?
              </option>
              {IMPACT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-card">Source (optional)</span>
          <input
            type="text"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="e.g., Facebook, WhatsApp, Instagram…"
            className={inputClass}
          />
        </label>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-bg"
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  )
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.replace(/[_-]/g, ' ').trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-bg p-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-card">{value}</p>
    </div>
  )
}

type Tag = 'Expert' | 'Verified' | 'Active'

const tagStyle: Record<Tag, string> = {
  Expert: 'bg-brand/10 text-brand',
  Verified: 'bg-secondary/15 text-secondary',
  Active: 'bg-highlight/25 text-ink',
}

// Map a commenter's standing to one of the Figma badges purely by credibility:
// Expert is the top tier, then Verified, then Active for everyone else.
function commenterTag(comment: CommentOut): Tag {
  if (comment.author_credibility >= 90) return 'Expert'
  if (comment.author_credibility >= 70) return 'Verified'
  return 'Active'
}

/**
 * Live "Community Fact-Checks" — real comments backed by the
 * /submissions/{id}/comments endpoints. Anyone can read; signed-in users can
 * post, and authors (or admins) can delete their own.
 */
function CommentSection({ submissionId }: { submissionId: number }) {
  const apiFetch = useApi()
  const { token, loginAsGuest } = useAuth()
  const [comments, setComments] = useState<CommentOut[] | null>(null)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')

  const loadComments = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/community/submissions/${submissionId}/comments`)
      setComments((await response.json()) as CommentOut[])
    } catch {
      setComments([])
    }
  }, [apiFetch, submissionId])

  useEffect(() => {
    void loadComments()
  }, [loadComments])

  async function submitComment() {
    const trimmed = body.trim()
    if (!trimmed) return
    setPosting(true)
    setError('')
    try {
      const response = await apiFetch(`/api/community/submissions/${submissionId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: trimmed }),
      })
      const created = (await response.json()) as CommentOut
      setComments((prev) => [created, ...(prev ?? [])])
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post your comment.')
    } finally {
      setPosting(false)
    }
  }

  async function deleteComment(commentId: number) {
    setError('')
    try {
      await apiFetch(`/api/community/submissions/${submissionId}/comments/${commentId}`, {
        method: 'DELETE',
      })
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this comment.')
    }
  }

  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-extrabold text-card">Community Fact-Checks</h2>
        {comments && (
          <span className="rounded-full bg-bg px-2.5 py-0.5 text-xs font-bold text-ink-soft">
            {comments.length}
          </span>
        )}
      </div>

      {token ? (
        <div className="mt-4">
          <textarea
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add your fact-check or what you found…"
            maxLength={2000}
            className="w-full resize-none rounded-2xl border border-black/10 bg-bg px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <div className="mt-2 flex items-center justify-end">
            <button
              type="button"
              disabled={!body.trim() || posting}
              onClick={() => void submitComment()}
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-black/5 bg-bg p-4 text-sm text-ink-soft">
          <p>Sign in to add a fact-check.</p>
          <div className="mt-3 flex gap-2">
            <Link
              to="/login"
              className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light"
            >
              Log in
            </Link>
            <button
              type="button"
              onClick={() => void loginAsGuest()}
              className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface"
            >
              Continue as guest
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{error}</p>}

      {comments === null ? (
        <p className="mt-5 text-sm text-ink-soft">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="mt-5 text-sm text-ink-soft">
          No fact-checks yet — be the first to weigh in.
        </p>
      ) : (
        <ul className="mt-5 space-y-5">
          {comments.map((comment) => {
            const tag = commenterTag(comment)
            return (
              <li key={comment.id} className="border-l-2 border-secondary/40 pl-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary/15 text-xs font-bold text-secondary">
                    {initials(comment.author)}
                  </span>
                  <span className="font-semibold text-card">{comment.author ?? 'Anonymous'}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tagStyle[tag]}`}>
                    {tag}
                  </span>
                  <span className="text-xs text-ink-faint">· {timeAgo(comment.created_at)}</span>
                  {comment.can_delete && (
                    <button
                      type="button"
                      onClick={() => void deleteComment(comment.id)}
                      className="ml-auto text-xs font-semibold text-risk-critical hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-soft">{comment.body}</p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
