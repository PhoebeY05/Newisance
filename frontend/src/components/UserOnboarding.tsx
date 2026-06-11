import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const STORAGE_PREFIX = 'newisance.onboarding.seen'

const steps = [
  {
    eyebrow: 'Start',
    title: 'Explore Newisance Town',
    body: 'Use the town as your main hub. Walk into a building to jump into games, verification, rankings, and your profile.',
    cta: 'Open town',
    to: '/learn',
    icon: '🏙️',
  },
  {
    eyebrow: 'Verify',
    title: 'Submit suspicious content',
    body: 'Paste a caption, link, image, or clip so the community can review it and build the misinformation database.',
    cta: 'Submit content',
    to: '/verify',
    icon: '🔍',
  },
  {
    eyebrow: 'Play',
    title: 'Build credibility through games',
    body: 'Try quick fact-checking challenges. Correct answers improve your credibility and help you climb the board.',
    cta: 'Choose a game',
    to: '/learn',
    icon: '🎮',
  },
  {
    eyebrow: 'Track',
    title: 'Watch your progress',
    body: 'Your profile shows credibility, tier, recent changes, and the weight your votes carry in community reviews.',
    cta: 'View profile',
    to: '/profile',
    icon: '⭐',
  },
] as const

export default function UserOnboarding() {
  const { user, loading } = useAuth()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  const storageKey = useMemo(() => {
    if (!user) return null
    return `${STORAGE_PREFIX}.${user.id}`
  }, [user])

  useEffect(() => {
    if (loading || !user || !storageKey) {
      setOpen(false)
      return
    }

    setOpen(window.localStorage.getItem(storageKey) !== '1')
  }, [loading, storageKey, user])

  if (!open || !storageKey) return null

  const current = steps[step]
  const isLast = step === steps.length - 1

  const finish = () => {
    window.localStorage.setItem(storageKey, '1')
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-card/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" onClick={finish} aria-label="Skip onboarding" />
      <section className="nz-pop relative w-full max-w-md overflow-hidden rounded-3xl border border-white/20 bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="bg-card px-6 pb-5 pt-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-secondary">{current.eyebrow}</p>
              <h2 className="mt-1 font-display text-2xl font-extrabold">Welcome to Newisance</h2>
            </div>
            <button
              type="button"
              onClick={finish}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-white/75 transition hover:bg-white/20 hover:text-white"
              aria-label="Close onboarding"
            >
              ×
            </button>
          </div>
          <div className="mt-5 flex gap-2">
            {steps.map((item, index) => (
              <button
                key={item.title}
                type="button"
                onClick={() => setStep(index)}
                aria-label={`Go to onboarding step ${index + 1}`}
                className={`h-1.5 flex-1 rounded-full transition ${
                  index <= step ? 'bg-secondary' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="p-6">
          <div className="flex gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-secondary/15 text-3xl">
              {current.icon}
            </span>
            <div>
              <h3 className="font-display text-xl font-extrabold text-card">{current.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-soft">{current.body}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={finish}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg hover:text-card"
            >
              Skip
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  className="rounded-xl border border-black/10 bg-surface px-4 py-2 text-sm font-bold text-card transition hover:bg-bg"
                >
                  Back
                </button>
              )}
              {isLast ? (
                <Link
                  to={current.to}
                  onClick={finish}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-light"
                >
                  {current.cta}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-light"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
