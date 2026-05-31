import { Link } from 'react-router-dom'

/**
 * Community — "Community Verification" feed (Figma node 89:594). Filter bar +
 * pending/your-checks counters, then a grid of submitted posts each with a
 * risk badge, source, fact-checker/comment counts, and a Verify This button.
 * Presentational only.
 */
export default function Community() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold text-card">Community Verification</h1>
        <p className="mt-3 text-lg text-ink-soft">
          Help verify suspicious content submitted by the community
        </p>
      </header>

      {/* Filter bar + counters */}
      <div className="mt-8 flex flex-wrap items-center gap-4 rounded-3xl border border-black/5 bg-surface p-5 shadow-sm">
        <Filter label="Category:" options={['All Categories', 'Scam', 'Health', 'Financial']} />
        <Filter label="Impact:" options={['All Levels', 'High', 'Medium', 'Low']} />
        <Filter label="Status:" options={['Pending Verification', 'Verified', 'Disputed']} />

        <div className="ml-auto flex gap-3">
          <Counter value="47" label="Pending" />
          <Counter value="128" label="Your Checks" />
        </div>
      </div>

      {/* Posts grid */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {posts.map((p) => (
          <article
            key={p.title}
            className="flex flex-col rounded-3xl border border-black/5 bg-surface p-6 shadow-sm transition hover:shadow-lg"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand">
                  {p.category}
                </span>
                <p className="mt-1 text-xs text-ink-soft">{p.submitted}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${riskStyle[p.risk]}`}>
                {p.risk}
              </span>
            </div>

            <div className="mt-4 rounded-2xl bg-bg p-4">
              <p className="text-sm font-semibold text-ink-soft">
                {p.mediaEmoji} {p.mediaType}
              </p>
              <p className="mt-2 font-bold text-card">{p.title}</p>
              <p className="mt-2 text-sm text-ink-soft">{p.desc}</p>
            </div>

            <p className="mt-3 text-xs text-ink-soft">
              {p.sourceEmoji} {p.source}
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-4">
              <div className="flex gap-4 text-sm text-ink-soft">
                <span>
                  <b className="text-card">{p.checkers}</b> fact-checkers
                </span>
                <span>
                  <b className="text-card">{p.comments}</b> comments
                </span>
              </div>
              <Link
                to="/community/post"
                className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-light"
              >
                Verify This
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function Filter({ label, options }: { label: string; options: string[] }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-ink-soft">{label}</span>
      <select className="rounded-xl border border-black/10 bg-bg px-3 py-1.5 font-medium text-ink">
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-bg px-4 py-2 text-center">
      <p className="font-display text-lg font-extrabold text-brand">{value}</p>
      <p className="text-xs text-ink-soft">{label}</p>
    </div>
  )
}

type Risk = 'High Risk' | 'Medium Risk' | 'Low Risk'

const riskStyle: Record<Risk, string> = {
  'High Risk': 'bg-risk-critical/15 text-risk-critical',
  'Medium Risk': 'bg-risk-med/15 text-risk-med',
  'Low Risk': 'bg-risk-low/15 text-risk-low',
}

const posts: {
  category: string
  submitted: string
  risk: Risk
  mediaEmoji: string
  mediaType: string
  title: string
  desc: string
  sourceEmoji: string
  source: string
  checkers: number
  comments: number
}[] = [
  {
    category: 'Deepfake Scam',
    submitted: 'Submitted 2 hours ago',
    risk: 'High Risk',
    mediaEmoji: '📱',
    mediaType: 'Social Media Screenshot',
    title: 'Deepfakes of PM Wong & senior govt officials used in impersonation scam',
    desc: 'Voice cloning detected. Multiple victims reported losing large sums. Sophisticated deepfake technology used to create convincing video messages requesting money transfers.',
    sourceEmoji: '📱',
    source: 'mustsharenews (Instagram)',
    checkers: 23,
    comments: 15,
  },
  {
    category: 'Health Misinformation',
    submitted: 'Submitted 5 hours ago',
    risk: 'Medium Risk',
    mediaEmoji: '🎥',
    mediaType: 'Video Clip',
    title: 'Viral video claims drinking lemon water cures diabetes and cancer',
    desc: 'No scientific evidence supports these claims. Video uses emotional testimonials without peer-reviewed research. Could prevent people from seeking proper medical treatment.',
    sourceEmoji: '📘',
    source: 'Health Remedies Daily (Facebook)',
    checkers: 18,
    comments: 8,
  },
  {
    category: 'Financial Scam',
    submitted: 'Submitted 8 hours ago',
    risk: 'High Risk',
    mediaEmoji: '📸',
    mediaType: 'Screenshot',
    title: 'WhatsApp message claims MAS is giving out S$5,000 grants - just click link',
    desc: 'Phishing attempt. Link leads to fake government website requesting bank details. MAS has issued official warning about this scam circulating widely.',
    sourceEmoji: '💬',
    source: 'WhatsApp forwarded message',
    checkers: 31,
    comments: 22,
  },
  {
    category: 'Misleading News',
    submitted: 'Submitted 1 day ago',
    risk: 'Low Risk',
    mediaEmoji: '📰',
    mediaType: 'News Article',
    title: "Article uses clickbait headline that doesn't match actual content",
    desc: 'Headline implies major scandal but article is about minor administrative issue. Classic clickbait tactic to drive traffic. Misleading but not completely fabricated.',
    sourceEmoji: '🌐',
    source: 'viral-news-sg.com',
    checkers: 12,
    comments: 5,
  },
]
