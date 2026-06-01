import { Link } from 'react-router-dom'

/**
 * Learn / "Choose Your Game Mode" screen — static frontend (Figma node
 * 39:125). Two game-mode cards: Battle Royale and Timed Challenge.
 * Presentational only — buttons route to the (stubbed) game screens.
 */
export default function Learn() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="text-center">
        <h1 className="font-display text-4xl font-extrabold text-card sm:text-5xl">
          Choose Your Game Mode
        </h1>
        <p className="mt-4 text-lg text-ink-soft">
          Pick your challenge and start earning credibility points!
        </p>
      </header>

      <div className="mx-auto mt-12 grid max-w-5xl gap-8 lg:grid-cols-2">
        {modes.map((m) => (
          <ModeCard key={m.id} mode={m} />
        ))}
      </div>
    </div>
  )
}

interface Mode {
  id: string
  emoji: string
  emojiSrc?: string
  badge: string
  title: string
  blurb: string
  features: string[]
  stats: { value: string; label: string }[]
  cta: string
  to: string
}

const modes: Mode[] = [
  {
    id: 'battle',
    emoji: '⚔️',
    badge: 'Multiplayer',
    title: 'Battle Royale',
    blurb:
      'Compete against others in real-time! Last fact-checker standing wins. Everyone sees the same content simultaneously.',
    features: [
      'Real-time multiplayer competition',
      'Elimination by wrong answers',
      'Winner takes all rewards',
    ],
    stats: [
      { value: '5-20', label: 'Players' },
      { value: '5-10', label: 'Minutes' },
      { value: '×3', label: 'Points' },
    ],
    cta: 'Start Battle Royale',
    to: '/battle-royale',
  },
  {
    id: 'timed',
    emoji: '🐦',
    emojiSrc: '/bird_avatar.png',
    badge: 'Solo Challenge',
    title: 'Timed Challenge',
    blurb:
      "Flappy Bird meets fact-checking! Navigate your newspaper through pipes labelled 'Real' or 'Fake' by tapping to fly.",
    features: ['Fast-paced arcade action', 'Increasing difficulty levels', 'Power-ups and bonuses'],
    stats: [
      { value: 'Solo', label: 'Players' },
      { value: '3-5', label: 'Minutes' },
      { value: '×2', label: 'Points' },
    ],
    cta: 'Start Timed Challenge',
    to: '/timed-challenge',
  },
]

function ModeCard({ mode }: { mode: Mode }) {
  return (
    <article className="flex flex-col rounded-3xl border border-black/5 bg-surface p-10 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
      {mode.emojiSrc ? (
        <img
          src={mode.emojiSrc}
          alt={`${mode.title} avatar`}
          className="h-16 w-16 object-contain"
        />
      ) : (
        <span className="text-6xl">{mode.emoji}</span>
      )}

      <span className="mt-6 w-fit rounded-full bg-secondary/15 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-secondary">
        {mode.badge}
      </span>

      <h2 className="mt-4 font-display text-3xl font-extrabold text-card">{mode.title}</h2>
      <p className="mt-3 text-ink-soft">{mode.blurb}</p>

      <ul className="mt-6 space-y-3">
        {mode.features.map((f) => (
          <li key={f} className="flex items-center gap-3 text-sm text-ink">
            <CheckIcon />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-8 grid grid-cols-3 gap-2 border-t border-black/5 pt-6">
        {mode.stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="font-display text-2xl font-extrabold text-brand">{s.value}</p>
            <p className="mt-1 text-xs text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      <Link
        to={mode.to}
        className="mt-8 inline-flex items-center justify-center gap-2 rounded-2xl bg-brand py-4 text-base font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light"
      >
        <PlayIcon /> {mode.cta}
      </Link>
    </article>
  )
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-secondary"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
      <path
        d="m8 12 2.5 2.5L16 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  )
}
