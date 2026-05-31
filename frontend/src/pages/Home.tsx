import { Link } from 'react-router-dom'

/**
 * Home screen — static frontend shell based on the Figma design
 * (frame "Home Page", node 7:38), styled to the Figma color scheme:
 * deep-blue brand, teal secondary, yellow highlight, navy cards,
 * green→red risk levels, on a light-gray background. No real features yet.
 */
export default function Home() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Hero />
      <WeeklyAlerts />
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <TopDefenders />
        <TopScams />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Hero */

function Hero() {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-2">
      <div>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-secondary/15 text-secondary">
            <ShieldIcon />
          </span>
          <span className="text-base font-semibold text-ink-soft">
            Spot the fake, Stop the spread!
          </span>
        </div>

        <h1 className="mt-6 max-w-xl font-display text-4xl font-extrabold leading-tight text-card sm:text-5xl">
          Stop Online <span className="text-brand">Newisance</span> Before It Spreads
        </h1>

        <p className="mt-5 max-w-lg text-lg text-ink-soft">
          Learn to identify misinformation, verify suspicious content, and start earning rewards!
        </p>

        <Link
          to="/timed-challenge"
          className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-brand px-7 py-4 text-lg font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/25">
            <PlayIcon />
          </span>
          Start Playing Now!
        </Link>
      </div>

      <RealOrFakeCard />
    </section>
  )
}

function RealOrFakeCard() {
  return (
    <div className="rounded-3xl bg-card p-6 shadow-xl shadow-card/20">
      <h2 className="text-center text-xl font-bold text-white">Is this real or fake?</h2>

      <div className="mt-5 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
        <div className="mx-auto max-w-xs rounded-2xl bg-surface p-4 shadow-sm">
          <p className="text-xs font-semibold text-ink-faint">SMS · Unknown sender</p>
          <p className="mt-2 text-sm text-ink">
            📦 Your parcel is on hold. A delivery fee of $1.99 is required. Confirm here:{' '}
            <span className="text-brand-light underline">bit.ly/redeliver-now</span>
          </p>
          <p className="mt-3 text-[11px] text-ink-faint">Today 09:14</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button className="rounded-xl bg-risk-critical/15 py-3 text-base font-bold text-risk-critical transition hover:bg-risk-critical/25">
          ✕ Fake
        </button>
        <button className="rounded-xl bg-risk-low/15 py-3 text-base font-bold text-risk-low transition hover:bg-risk-low/25">
          ✓ Real
        </button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- Weekly alerts */

type Tone = 'sms' | 'email' | 'social'

interface Alert {
  id: string
  title: string
  scamPercent: number
  impact: number
  blurb: string
  tone: Tone
}

const weeklyAlerts: Alert[] = [
  {
    id: 'parcel-sms',
    title: 'Fake parcel delivery SMS',
    scamPercent: 89,
    impact: 5,
    blurb: '“Your parcel is held. Pay a small fee to release it.” A classic redelivery scam.',
    tone: 'sms',
  },
  {
    id: 'bank-otp',
    title: 'Bank “verify your account” email',
    scamPercent: 94,
    impact: 5,
    blurb: 'Spoofed sender asks you to confirm an OTP. Never share one-time codes.',
    tone: 'email',
  },
  {
    id: 'giveaway',
    title: 'Celebrity crypto giveaway',
    scamPercent: 97,
    impact: 4,
    blurb: '“Send 0.1 ETH, get 1 ETH back.” Doubling schemes are always fake.',
    tone: 'social',
  },
  {
    id: 'job-offer',
    title: 'Too-good-to-be-true job offer',
    scamPercent: 62,
    impact: 3,
    blurb: 'High pay, no interview, upfront “training kit” payment required.',
    tone: 'email',
  },
]

const toneStyles: Record<Tone, string> = {
  sms: 'bg-brand-light/15 text-brand-light',
  email: 'bg-brand/10 text-brand',
  social: 'bg-secondary/15 text-secondary',
}

const toneEmoji: Record<Tone, string> = {
  sms: '💬',
  email: '✉️',
  social: '🌐',
}

/** Map a scam-likelihood % to one of the Figma risk-level colors. */
function riskColor(percent: number) {
  if (percent >= 90) return 'bg-risk-critical/15 text-risk-critical'
  if (percent >= 75) return 'bg-risk-high/15 text-risk-high'
  if (percent >= 50) return 'bg-risk-med/15 text-risk-med'
  return 'bg-risk-low/15 text-risk-low'
}

function WeeklyAlerts() {
  return (
    <section className="mt-14">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-extrabold text-card">
          This week’s Newisance Alerts
        </h2>
        <button
          aria-label="Next alerts"
          className="grid h-10 w-10 place-items-center rounded-full bg-surface text-card shadow-md transition hover:bg-brand hover:text-white"
        >
          <ArrowIcon />
        </button>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {weeklyAlerts.map((alert) => (
          <article
            key={alert.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-surface shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
          >
            <div className={`grid h-28 place-items-center text-4xl ${toneStyles[alert.tone]}`}>
              {toneEmoji[alert.tone]}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <h3 className="font-bold text-card">{alert.title}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-soft">{alert.blurb}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${riskColor(alert.scamPercent)}`}
                >
                  {alert.scamPercent}% Likely Scam
                </span>
                <span className="rounded-full bg-highlight/25 px-2.5 py-1 text-xs font-bold text-ink">
                  {alert.impact}/5 Impact!
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* -------------------------------------------------------- Top defenders */

interface Defender {
  rank: number
  name: string
  points: number
}

const topDefenders: Defender[] = [
  { rank: 1, name: 'Priya N.', points: 4820 },
  { rank: 2, name: 'Marcus L.', points: 4510 },
  { rank: 3, name: 'Aisha K.', points: 4275 },
  { rank: 4, name: 'Diego R.', points: 3990 },
  { rank: 5, name: 'Mei T.', points: 3710 },
]

const medal: Record<number, string> = {
  1: 'bg-highlight text-ink',
  2: 'bg-ink-faint text-white',
  3: 'bg-risk-med text-white',
}

function TopDefenders() {
  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <h2 className="font-display text-xl font-extrabold text-card">Top Newisance Defenders!</h2>
      <ul className="mt-5 space-y-3">
        {topDefenders.map((d) => {
          const initials = d.name
            .split(' ')
            .map((p) => p[0])
            .join('')
          return (
            <li key={d.rank} className="flex items-center gap-4 rounded-xl bg-bg px-4 py-3">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
                  medal[d.rank] ?? 'bg-brand text-white'
                }`}
              >
                {d.rank}
              </span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary/15 text-sm font-bold text-secondary">
                {initials}
              </span>
              <span className="flex-1 font-semibold text-card">{d.name}</span>
              <span className="font-bold text-brand">{d.points.toLocaleString()} pts</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------ Top scams */

interface ScamStat {
  label: string
  value: number
}

const topScams: ScamStat[] = [
  { label: 'Phishing SMS', value: 92 },
  { label: 'Fake invoices', value: 78 },
  { label: 'Crypto scams', value: 71 },
  { label: 'Romance fraud', value: 55 },
  { label: 'Deepfake clips', value: 44 },
]

function TopScams() {
  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-extrabold text-card">
          Top Newisances Of All Time
        </h2>
        <Link to="/leaderboard" className="text-sm font-semibold text-brand hover:underline">
          View more…
        </Link>
      </div>
      <div className="mt-6 space-y-4">
        {topScams.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-card">{s.label}</span>
              <span className="font-bold text-ink-soft">{s.value}%</span>
            </div>
            <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-gradient-to-r from-secondary to-brand-light"
                style={{ width: `${s.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* --------------------------------------------------------------- Icons */

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m8.5 12 2.3 2.3L15.5 9.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
