import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

type MediaType = 'text' | 'image' | 'link' | 'video'

const VERIFY_API_ENDPOINT = import.meta.env.VITE_VERIFY_API_URL ?? '/api/verifications'

/**
 * Verify — "Community Verification" screen (Figma node 39:205). Left column:
 * content-type picker + submission form. Right column: community impact
 * stats, how verification works, and best-submission tips. Presentational
 * only — nothing is uploaded or analyzed.
 */
export default function Verify() {
  const [mediaType, setMediaType] = useState<MediaType>('image')
  const [reason, setReason] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [impactLevel, setImpactLevel] = useState('')
  const [source, setSource] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [feedback, setFeedback] = useState('')

  const requiresFile = mediaType === 'image' || mediaType === 'video'
  const requiresUrl = mediaType === 'link'

  const contentFieldLabel =
    mediaType === 'text'
      ? 'Text / Caption*'
      : mediaType === 'link'
        ? 'URL / Link*'
        : mediaType === 'video'
          ? 'Upload Video Clip*'
          : 'Upload Image / Screenshot*'

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!reason.trim() || !category || !impactLevel) {
      setStatus('error')
      setFeedback('Please fill out the required fields before submitting.')
      return
    }

    if (requiresFile && !file) {
      setStatus('error')
      setFeedback('Please choose a file for the selected media type.')
      return
    }

    if (requiresUrl && !content.trim()) {
      setStatus('error')
      setFeedback('Please enter a URL for the selected media type.')
      return
    }

    if (mediaType === 'text' && !content.trim()) {
      setStatus('error')
      setFeedback('Please paste the text or caption you want to verify.')
      return
    }

    setStatus('submitting')
    setFeedback('')

    try {
      const formData = new FormData()
      formData.append('mediaType', mediaType)
      formData.append('reason', reason.trim())
      formData.append('category', category)
      formData.append('impactLevel', impactLevel)

      if (source.trim()) {
        formData.append('source', source.trim())
      }

      if (mediaType === 'text') {
        formData.append('content', content.trim())
      } else if (mediaType === 'link') {
        formData.append('url', content.trim())
      } else if (file) {
        formData.append('file', file)
      }

      const response = await fetch(VERIFY_API_ENDPOINT, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      setStatus('success')
      setFeedback('Submission sent successfully.')
      setReason('')
      setContent('')
      setCategory('')
      setImpactLevel('')
      setSource('')
      setFile(null)
    } catch (error) {
      setStatus('error')
      setFeedback(
        error instanceof Error && error.message
          ? error.message
          : 'Submission failed. Check the backend endpoint and try again.',
      )
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <div className="flex justify-end">
        <Link
          to="/community"
          className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-surface px-4 py-2 text-sm font-semibold text-brand shadow-sm transition hover:bg-bg"
        >
          <InboxIcon /> Go to Feed
        </Link>
      </div>
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold text-card">Community Verification</h1>
        <p className="mt-3 text-lg text-ink-soft">
          Help protect your community by submitting suspicious content for expert review
        </p>
        <p className="mx-auto mt-6 w-fit rounded-full bg-secondary/15 px-5 py-2 text-sm font-semibold text-secondary">
          📊 Your submissions help build our misinformation database
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        {/* Left column — upload form */}
        <div className="space-y-6">
          <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {contentTypes.map((c) => (
                <button
                  key={c.title}
                  type="button"
                  onClick={() => {
                    setMediaType(c.value)
                    setFile(null)
                  }}
                  aria-pressed={mediaType === c.value}
                  className={`flex flex-col items-center gap-1 rounded-2xl border p-4 text-center transition ${
                    mediaType === c.value
                      ? 'border-brand bg-brand/5 ring-2 ring-brand/15'
                      : 'border-black/10 bg-surface hover:border-brand/40'
                  }`}
                >
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="text-sm font-bold text-card">{c.title}</span>
                  <span className="text-xs text-ink-soft">{c.sub}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm text-ink-soft">
              Currently selected: <span className="font-semibold text-card">{contentTypesByValue[mediaType].title}</span>
            </p>
          </section>

          <form onSubmit={handleSubmit} className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl font-extrabold text-card">
              Submit Content for Verification
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Provide details to help our community assess the content accurately
            </p>

            {feedback && (
              <p
                className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${
                  status === 'success'
                    ? 'bg-risk-low/10 text-risk-low'
                    : 'bg-risk-high/10 text-risk-high'
                }`}
              >
                {feedback}
              </p>
            )}

            <div className="mt-6 space-y-5">
              <Field label="What makes you suspicious?*">
                <textarea
                  rows={4}
                  placeholder="Explain why you think this content might be false or misleading..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={`${inputClass} resize-none`}
                />
              </Field>

              {mediaType === 'text' ? (
                <Field label={contentFieldLabel}>
                  <textarea
                    rows={4}
                    placeholder="Paste the text or caption here..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className={`${inputClass} resize-none`}
                  />
                </Field>
              ) : mediaType === 'link' ? (
                <Field label={contentFieldLabel}>
                  <input
                    type="url"
                    placeholder="https://example.com/article"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              ) : (
                <Field label={contentFieldLabel}>
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/15 bg-bg px-6 py-10 text-center transition hover:border-brand/40 hover:bg-brand/5">
                    <input
                      type="file"
                      className="sr-only"
                      accept={mediaType === 'video' ? 'video/*' : 'image/*'}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    <UploadIcon />
                    <p className="mt-3 text-sm font-semibold text-card">
                      {file ? file.name : 'Click to upload or drag and drop'}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {mediaType === 'video' ? 'MP4, MOV, WEBM up to 100MB' : 'PNG, JPG, WEBP up to 10MB'}
                    </p>
                  </label>
                </Field>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Category*">
                  <select
                    className={`${inputClass} appearance-none`}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="" disabled>
                      Select category...
                    </option>
                    <option value="Health & Medical">Health &amp; Medical</option>
                    <option value="Politics">Politics</option>
                    <option value="Technology">Technology</option>
                    <option value="Finance">Finance</option>
                  </select>
                </Field>
                <Field label="Impact Level">
                  <select
                    className={`${inputClass} appearance-none`}
                    value={impactLevel}
                    onChange={(e) => setImpactLevel(e.target.value)}
                  >
                    <option value="" disabled>
                      How harmful?
                    </option>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </Field>
              </div>

              <Field label="Source (Optional)">
                <input
                  type="text"
                  placeholder="e.g., Facebook, WhatsApp, Instagram..."
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-70"
              >
                {status === 'submitting' ? 'Submitting...' : 'Submit for Verification'}
              </button>
            </div>
          </form>
        </div>

        {/* Right column — info */}
        <div className="space-y-6">
          <section className="rounded-3xl bg-card p-6 text-white shadow-sm">
            <h2 className="font-display text-lg font-extrabold">Community Impact Today</h2>
            <div className="mt-5 grid grid-cols-2 gap-4">
              {impact.map((i) => (
                <div key={i.label}>
                  <p className="font-display text-2xl font-extrabold text-secondary">{i.value}</p>
                  <p className="text-xs text-white/60">{i.label}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-lg font-extrabold text-card">How Verification Works</h2>
            <ol className="mt-5 space-y-4">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-card">{s.title}</p>
                    <p className="text-sm text-ink-soft">{s.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-lg font-extrabold text-card">Best Submissions</h2>
            <ul className="mt-4 space-y-2.5">
              {bestTips.map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm text-ink">
                  <span className="text-risk-low">✓</span> {t}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

const inputClass =
  'mt-1.5 w-full rounded-xl border border-black/10 bg-bg px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-card">{label}</span>
      {children}
    </label>
  )
}

const contentTypes = [
  { value: 'text' as const, emoji: '📝', title: 'Text / Caption', sub: 'Social posts, messages' },
  { value: 'image' as const, emoji: '🖼️', title: 'Image / Screenshot', sub: 'Photos, screenshots' },
  { value: 'link' as const, emoji: '🔗', title: 'URL / Link', sub: 'Websites, articles' },
  { value: 'video' as const, emoji: '🎥', title: 'Video Clip', sub: 'Short videos' },
]

const contentTypesByValue = Object.fromEntries(contentTypes.map((type) => [type.value, type])) as Record<
  MediaType,
  (typeof contentTypes)[number]
>

const impact = [
  { value: '1,234', label: 'Posts Verified' },
  { value: '892', label: 'Threats Detected' },
  { value: '3,456', label: 'Active Users' },
  { value: '94%', label: 'Accuracy Rate' },
]

const steps = [
  { title: 'Community Review', desc: 'Reviewed by verified fact-checkers' },
  { title: 'Credibility Weighted', desc: 'Higher credibility = greater influence' },
  { title: 'AI Analysis Support', desc: 'Pattern detection & context' },
  { title: 'Final Verdict', desc: 'Detailed report with score' },
]

const bestTips = [
  'Clear, high-quality images',
  'Context about source',
  'Why it seems suspicious',
  'Sharing frequency info',
]

function InboxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 13h4l1.5 3h5L16 13h4M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-ink-faint" aria-hidden>
      <path
        d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
