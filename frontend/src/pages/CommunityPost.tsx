import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Community Post Details — (Figma node 89:659). Left column: the submitted
 * post, "Why Suspicious?" and meta. Right column: your verification controls,
 * community consensus, and community fact-checks. Presentational only.
 */
export default function CommunityPost() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Link
        to="/community"
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
      >
        ← Back to Feed
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* Left — post details */}
        <div className="space-y-6">
          <article className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand">
                  Deepfake Scam
                </span>
                <p className="mt-1 text-xs text-ink-soft">Submitted 2 hours ago</p>
              </div>
              <span className="rounded-full bg-risk-low/15 px-3 py-1 text-xs font-bold text-risk-low">
                Low Risk
              </span>
            </div>

            <h1 className="mt-4 font-display text-2xl font-extrabold text-card">
              Deepfakes of PM Wong & senior govt officials used in impersonation scam
            </h1>

            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary/15 text-sm font-bold text-secondary">
                AW
              </span>
              <div>
                <p className="text-sm font-semibold text-card">Alex Wong</p>
                <p className="text-xs text-ink-soft">Submitted by</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl bg-bg p-4 text-sm font-semibold text-ink-soft">
              📱 Social Media Screenshot
            </div>
          </article>

          <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl font-extrabold text-card">Why Suspicious?</h2>
            <p className="mt-3 rounded-2xl border border-black/5 bg-bg p-4 text-sm leading-relaxed text-ink-soft">
              Voice cloning detected in multiple video clips. Victims reported receiving convincing
              deepfake videos of government officials requesting urgent money transfers for
              "national security operations." Technology analysis reveals sophisticated voice
              synthesis and facial manipulation. Videos use real footage spliced with AI-generated
              segments. One victim lost S$4.9M after receiving what appeared to be a video call
              from a senior official.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Meta label="Source Platform" value="📱 mustsharenews (Instagram)" />
              <Meta label="Category" value="Deepfake Scam" />
              <Meta label="Impact Level" value="Low Risk" />
              <Meta
                label="AI Analysis verdict"
                value={
                  <Link to="/ai-analysis" className="font-semibold text-brand hover:underline">
                    Real (See more)
                  </Link>
                }
              />
            </div>
          </section>
        </div>

        {/* Right — verification + community */}
        <div className="space-y-6">
          <section className="rounded-3xl bg-card p-6 text-white shadow-sm">
            <h2 className="font-display text-xl font-extrabold">Your Verification</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button className="rounded-xl bg-risk-critical py-3 font-extrabold text-white transition hover:opacity-90">
                FAKE
              </button>
              <button className="rounded-xl bg-risk-low py-3 font-extrabold text-white transition hover:opacity-90">
                REAL
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/5 p-3 text-center ring-1 ring-white/10">
                <p className="font-display text-2xl font-extrabold text-risk-critical">2</p>
                <p className="text-xs text-white/60">Say FAKE</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3 text-center ring-1 ring-white/10">
                <p className="font-display text-2xl font-extrabold text-risk-low">21</p>
                <p className="text-xs text-white/60">Say REAL</p>
              </div>
            </div>

            <p className="mt-4 rounded-2xl bg-white/5 p-3 text-center text-sm ring-1 ring-white/10">
              Community Consensus: 3% Likely Scam, 4/5 Impact!
            </p>

            <label className="mt-4 block text-sm">
              <span className="text-white/70">Impact:</span>
              <input type="range" min={1} max={5} defaultValue={4} className="mt-2 w-full accent-secondary" />
              <div className="flex justify-between text-xs text-white/40">
                <span>1</span>
                <span>5</span>
              </div>
            </label>
          </section>

          <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl font-extrabold text-card">Community Fact-Checks</h2>
            <ul className="mt-5 space-y-5">
              {factChecks.map((f) => (
                <li key={f.name} className="border-l-2 border-secondary/40 pl-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary/15 text-xs font-bold text-secondary">
                      {f.initials}
                    </span>
                    <span className="font-semibold text-card">{f.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tagStyle[f.tag]}`}>
                      {f.tag}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">{f.text}</p>
                  {f.link && (
                    <span className="mt-2 inline-block text-sm font-semibold text-brand">
                      {f.link} →
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
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

const factChecks: { initials: string; name: string; tag: Tag; text: string; link?: string }[] = [
  {
    initials: 'DR',
    name: 'Dr. Rachel Tan',
    tag: 'Expert',
    text: "As a digital forensics specialist, I can confirm this uses DeepFaceLab-style manipulation. The facial movements don't match natural speech patterns, and spectral analysis shows voice synthesis artifacts.",
    link: 'SPF Advisory on Deepfake Scams',
  },
  {
    initials: 'JL',
    name: 'James Lim',
    tag: 'Verified',
    text: "Cross-referenced with official government channels. PM Wong's office has issued a statement confirming these videos are fake and warning the public not to respond to such requests.",
    link: 'PMO Official Statement',
  },
  {
    initials: 'SK',
    name: 'Sarah Koh',
    tag: 'Active',
    text: 'Similar scams reported on r/singapore. Multiple victims came forward sharing nearly identical experiences. Pattern matches known deepfake scam operations.',
  },
]
