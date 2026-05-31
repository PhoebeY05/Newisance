/**
 * Dashboard — "Critical Misinformation Dashboard" (Figma node 39:216).
 * A PUBLIC awareness dashboard: headline stats, top misinformation this
 * week, and trending scam patterns. All data is hardcoded mock matching
 * the Figma design.
 */
export default function Dashboard() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold text-card sm:text-5xl">
          Critical Misinformation Dashboard
        </h1>
        <p className="mt-3 text-lg text-ink-soft">
          Real-time tracking of the most important misinformation trends
        </p>
      </header>

      {/* Headline stats */}
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {headlineStats.map((s) => (
          <div key={s.label} className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className={`grid h-12 w-12 place-items-center rounded-xl text-2xl ${s.tint}`}>
                {s.emoji}
              </span>
              <span className="text-xs font-semibold text-risk-low">{s.delta}</span>
            </div>
            <p className="mt-4 font-display text-3xl font-extrabold text-card">{s.value}</p>
            <p className="mt-1 text-sm text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Top misinformation this week */}
      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-extrabold text-card">
            Top Misinformation This Week
          </h2>
          <select
            defaultValue="All Categories"
            className="rounded-xl border border-black/10 bg-surface px-4 py-2 text-sm font-medium text-ink"
          >
            <option>All Categories</option>
            <option>Scam</option>
            <option>Deepfake</option>
            <option>Misinformation</option>
            <option>Fraud</option>
          </select>
        </div>

        <ul className="mt-6 space-y-4">
          {topMisinfo.map((m) => (
            <li
              key={m.rank}
              className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-surface p-5 shadow-sm sm:flex-row sm:items-center"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-bg font-display text-lg font-extrabold text-ink-faint">
                {m.rank}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-card">{m.title}</h3>
                  <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
                    {m.category}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {m.likelihood} · Impact: {m.impact}/5
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${riskStyle[m.risk]}`}>
                {m.risk}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Trending scam patterns */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-extrabold text-card">Trending Scam Patterns</h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {patterns.map((p) => (
            <article
              key={p.title}
              className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm"
            >
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${trendStyle[p.trend]}`}>
                {p.tag}
              </span>
              <h3 className="mt-4 font-display text-lg font-bold text-card">{p.title}</h3>
              <p className="mt-2 text-sm text-ink-soft">{p.desc}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

const headlineStats = [
  { emoji: '🚨', value: '47', label: 'Active Alerts', delta: '+12 this week', tint: 'bg-risk-critical/15' },
  { emoji: '✅', value: '1,234', label: 'Community Verifications', delta: '+89 today', tint: 'bg-risk-low/15' },
  { emoji: '🛡️', value: '892', label: 'Threats Detected', delta: '+23 today', tint: 'bg-brand/10' },
]

type Risk = 'High Risk' | 'Medium Risk' | 'Low Risk'

const topMisinfo: { rank: number; title: string; category: string; likelihood: string; impact: number; risk: Risk }[] = [
  { rank: 1, title: 'Fake parcel delivery SMS', category: 'Scam', likelihood: '89% Likely Scam', impact: 5, risk: 'High Risk' },
  { rank: 2, title: 'AI-generated politician deepfake', category: 'Deepfake', likelihood: '94% Likely Fake', impact: 5, risk: 'High Risk' },
  { rank: 3, title: 'Misleading health supplement claim', category: 'Misinformation', likelihood: '67% Likely False', impact: 3, risk: 'Medium Risk' },
  { rank: 4, title: 'Fake government grant scam', category: 'Fraud', likelihood: '91% Likely Scam', impact: 4, risk: 'High Risk' },
]

const riskStyle: Record<Risk, string> = {
  'High Risk': 'bg-risk-critical/15 text-risk-critical',
  'Medium Risk': 'bg-risk-med/15 text-risk-med',
  'Low Risk': 'bg-risk-low/15 text-risk-low',
}

type Trend = 'rising' | 'new' | 'persistent'

const patterns: { title: string; desc: string; tag: string; trend: Trend }[] = [
  { title: 'Fake Delivery SMS', desc: 'Phishing messages impersonating courier services', tag: 'Rising +234%', trend: 'rising' },
  { title: 'AI Voice Cloning Scams', desc: 'Fraudsters using AI to clone voices of family members', tag: 'New', trend: 'new' },
  { title: 'Investment Fraud', desc: 'Fake cryptocurrency and stock trading platforms', tag: 'Ongoing', trend: 'persistent' },
]

const trendStyle: Record<Trend, string> = {
  rising: 'bg-risk-critical/15 text-risk-critical',
  new: 'bg-secondary/15 text-secondary',
  persistent: 'bg-risk-med/15 text-risk-med',
}
