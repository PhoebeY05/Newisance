import { Link } from 'react-router-dom'

/**
 * AI Analysis — "AI-Powered Analysis" screen (Figma node 92:2). Overall
 * credibility score, an analysis grid (Source Credibility, Fact-Checking,
 * Cross-Verification, Misinformation Check), cross-referenced evidence, and
 * verification methodology. Presentational only.
 */
export default function AIAnalysis() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Link
        to="/community/post"
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
      >
        ← Back to Post
      </Link>

      {/* Header + overall score */}
      <section className="mt-6 grid gap-6 rounded-3xl bg-card p-8 text-white lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold">AI-Powered Analysis</h1>
            <span className="rounded-full bg-secondary/20 px-3 py-1 text-xs font-bold text-secondary">
              🤖 Automated
            </span>
          </div>
          <p className="mt-2 text-white/70">AI-powered analysis and credibility assessment</p>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-white/80">
            Our AI systems verified this news story through multiple credible sources including
            government statements, police advisories, and independent media reports. The deepfake
            scam being reported is highly possible to have actually occurred.
          </p>
        </div>
        <div className="grid place-items-center rounded-3xl bg-white/5 p-8 ring-1 ring-white/10">
          <p className="font-display text-5xl font-extrabold text-risk-low">94%</p>
          <p className="mt-1 text-sm font-semibold text-white/70">Credible</p>
        </div>
      </section>

      {/* Analysis grid */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <AnalysisCard icon="🔍" title="Source Credibility" items={sourceItems} />
        <AnalysisCard icon="✓" title="Fact-Checking" scores={factScores} items={factItems} />
        <AnalysisCard icon="📊" title="Cross-Verification" items={crossItems} />
        <AnalysisCard
          icon="⚠️"
          title="Misinformation Check"
          scores={misinfoScores}
          note="NO MISINFORMATION DETECTED"
        />
      </div>

      {/* Cross-referenced evidence */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-extrabold text-card">Cross-Referenced Evidence</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {evidence.map((e) => (
            <article
              key={e.title}
              className="flex flex-col rounded-3xl border border-black/5 bg-surface p-6 shadow-sm"
            >
              <span className="text-3xl">{e.emoji}</span>
              <h3 className="mt-3 font-bold text-card">{e.title}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-soft">{e.desc}</p>
              <span className="mt-4 text-sm font-semibold text-brand">{e.link} →</span>
            </article>
          ))}
        </div>
      </section>

      {/* Methodology */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-extrabold text-card">Verification Methodology</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {methodology.map((m) => (
            <div key={m.title} className="rounded-2xl border border-black/5 bg-surface p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {m.title}
              </p>
              <p className="mt-1 font-display text-lg font-extrabold text-card">{m.value}</p>
              <p className="mt-2 text-sm text-ink-soft">{m.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

interface Item {
  title: string
  confidence: string
  desc: string
}

function AnalysisCard({
  icon,
  title,
  items,
  scores,
  note,
}: {
  icon: string
  title: string
  items?: Item[]
  scores?: { label: string; value: string }[]
  note?: string
}) {
  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-3 border-b border-black/5 pb-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-lg">
          {icon}
        </span>
        <h2 className="font-display text-lg font-extrabold text-card">{title}</h2>
      </div>

      {scores && (
        <div className="mt-4 space-y-3">
          {scores.map((s) => (
            <div key={s.label} className="flex items-center justify-between border-b border-black/5 pb-2 text-sm">
              <span className="text-ink-soft">{s.label}</span>
              <span className="font-bold text-card">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {items && (
        <ul className="mt-4 space-y-4">
          {items.map((it) => (
            <li key={it.title} className="border-l-2 border-risk-low/40 pl-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-card">{it.title}</p>
                <span className="text-xs font-bold text-risk-low">{it.confidence}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{it.desc}</p>
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="mt-4 rounded-2xl bg-risk-low/10 p-4 text-sm font-bold text-risk-low">
          ✓ {note}
        </p>
      )}
    </section>
  )
}

const sourceItems: Item[] = [
  {
    title: 'Official Government Confirmation',
    confidence: '100% Confidence',
    desc: "Prime Minister's Office issued official statement confirming the deepfake scam and warning public. Statement verified on gov.sg domain.",
  },
  {
    title: 'Law Enforcement Verified',
    confidence: '100% Confidence',
    desc: 'Singapore Police Force published advisory about this specific scam on official channels. Multiple victim reports filed.',
  },
  {
    title: 'Reputable Media Coverage',
    confidence: '98% Confidence',
    desc: 'Story reported by CNA, Straits Times, and TODAY with consistent details. All sources cite official government statements.',
  },
]

const factScores = [
  { label: 'Claim Accuracy', value: '9.6/10' },
  { label: 'Source Authority', value: '10.0/10' },
  { label: 'Evidence Quality', value: '9.4/10' },
]

const factItems: Item[] = [
  {
    title: 'Multiple Independent Sources',
    confidence: '100% Confidence',
    desc: 'Story corroborated by 12+ independent sources including government agencies, media outlets, and victim testimonies.',
  },
]

const crossItems: Item[] = [
  {
    title: 'Timeline Consistency',
    confidence: '97% Confidence',
    desc: 'All sources report consistent timeline: scam operation active from Jan-Mar 2024, with victims coming forward in February.',
  },
  {
    title: 'Financial Loss Verified',
    confidence: '94% Confidence',
    desc: 'S$4.9M victim loss confirmed through police reports and official ScamAlert database. Multiple other victims documented.',
  },
  {
    title: 'Expert Analysis Available',
    confidence: '92% Confidence',
    desc: 'Digital forensics experts from NTU and SUTD analyzed the scam and confirmed deepfake technology was used by perpetrators.',
  },
]

const misinfoScores = [
  { label: 'Fabrication Risk', value: '0.6/10' },
  { label: 'Sensationalism Score', value: '2.1/10' },
  { label: 'Clickbait Probability', value: '1.8/10' },
]

const evidence = [
  { emoji: '🏛️', title: 'Official Government Statement', desc: "Prime Minister's Office confirmed videos are fabricated and warned public not to respond to such requests.", link: 'View PMO Statement' },
  { emoji: '🚨', title: 'Police Advisory', desc: 'Singapore Police Force issued warning about deepfake impersonation scams targeting seniors with similar tactics.', link: 'View SPF Advisory' },
  { emoji: '📰', title: 'Media Coverage', desc: 'Multiple credible news outlets reported on this scam, with verified victim testimonies and expert analysis.', link: 'View News Articles' },
  { emoji: '🔬', title: 'Technical Analysis', desc: 'Digital forensics experts from NTU analyzed video and confirmed use of DeepFaceLab-style manipulation.', link: 'View Technical Report' },
  { emoji: '💰', title: 'Victim Reports', desc: 'ScamAlert.sg documented 12 confirmed victims with total losses exceeding S$8.2M from this scam operation.', link: 'View Victim Database' },
  { emoji: '🌐', title: 'Similar Content', desc: 'Found 47 near-identical posts across platforms, suggesting coordinated scam campaign with multiple variants.', link: 'View Similar Posts' },
]

const methodology = [
  { title: 'Analysis Model', value: 'NewsVerifier AI v4.1', desc: 'Multi-source fact-checking system trained on 8.2M verified news articles with 98.7% accuracy on benchmark datasets.' },
  { title: 'Processing Time', value: '1.8 seconds', desc: 'Automated verification completed by cross-referencing 47 authoritative sources in real-time.' },
  { title: 'Source Quality', value: 'Official + Verified Media', desc: 'Claims verified through government statements (gov.sg), police advisories, and established news organizations.' },
  { title: 'Confidence Score', value: '94.2% Verified True', desc: 'Aggregated confidence across source credibility, claim consistency, and temporal verification checks.' },
  { title: 'Cross-References', value: '12 Independent Sources', desc: 'Story corroborated by PMO, SPF, CNA, Straits Times, TODAY, and 7 other credible outlets.' },
  { title: 'Last Updated', value: '3 minutes ago', desc: 'Verification refreshed automatically as new official statements and evidence emerge.' },
]
