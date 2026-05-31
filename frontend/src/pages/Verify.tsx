import type { ReactNode } from 'react'

/**
 * Verify — "Community Verification" screen (Figma node 39:205). Left column:
 * content-type picker + submission form. Right column: community impact
 * stats, how verification works, and best-submission tips. Presentational
 * only — nothing is uploaded or analyzed.
 */
export default function Verify() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
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
              {contentTypes.map((c, i) => (
                <button
                  key={c.title}
                  className={`flex flex-col items-center gap-1 rounded-2xl border p-4 text-center transition ${
                    i === 0
                      ? 'border-brand bg-brand/5'
                      : 'border-black/10 bg-surface hover:border-brand/40'
                  }`}
                >
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="text-sm font-bold text-card">{c.title}</span>
                  <span className="text-xs text-ink-soft">{c.sub}</span>
                </button>
              ))}
            </div>
          </section>

          <form
            onSubmit={(e) => e.preventDefault()}
            className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm"
          >
            <h2 className="font-display text-xl font-extrabold text-card">
              Submit Content for Verification
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Provide details to help our community assess the content accurately
            </p>

            <div className="mt-6 space-y-5">
              <Field label="What makes you suspicious?*">
                <textarea
                  rows={4}
                  placeholder="Explain why you think this content might be false or misleading..."
                  className={`${inputClass} resize-none`}
                />
              </Field>

              <Field label="Upload Image / Screenshot*">
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/15 bg-bg px-6 py-10 text-center">
                  <UploadIcon />
                  <p className="mt-3 text-sm font-semibold text-card">
                    Click to upload or drag and drop
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">PNG, JPG, WEBP up to 10MB</p>
                </div>
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Category*">
                  <select className={`${inputClass} appearance-none`} defaultValue="">
                    <option value="" disabled>
                      Select category...
                    </option>
                    <option>Health &amp; Medical</option>
                    <option>Politics</option>
                    <option>Technology</option>
                    <option>Finance</option>
                  </select>
                </Field>
                <Field label="Impact Level">
                  <select className={`${inputClass} appearance-none`} defaultValue="">
                    <option value="" disabled>
                      How harmful?
                    </option>
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                  </select>
                </Field>
              </div>

              <Field label="Source (Optional)">
                <input
                  type="text"
                  placeholder="e.g., Facebook, WhatsApp, Instagram..."
                  className={inputClass}
                />
              </Field>

              <button
                type="submit"
                className="w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-light"
              >
                Submit for Verification
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
  { emoji: '📝', title: 'Text / Caption', sub: 'Social posts, messages' },
  { emoji: '🖼️', title: 'Image / Screenshot', sub: 'Photos, screenshots' },
  { emoji: '🔗', title: 'URL / Link', sub: 'Websites, articles' },
  { emoji: '🎥', title: 'Video Clip', sub: 'Short videos' },
]

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
