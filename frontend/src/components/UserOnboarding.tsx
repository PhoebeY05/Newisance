import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const STORAGE_PREFIX = 'newisance.onboarding.seen'
const POPUP_WIDTH = 360
const POPUP_HEIGHT_ESTIMATE = 260

interface TourStep {
  eyebrow: string
  title: string
  body: string
  route: string
  selector: string
  hint: string
}

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

const steps: TourStep[] = [
  {
    eyebrow: 'Start here',
    title: 'Jump into the town hub',
    body: 'This button opens Newisance Town, the main 3D hub where each building takes you to a feature or game.',
    route: '/',
    selector: '[data-tour="start-playing"]',
    hint: 'Click it later whenever you want the full town menu.',
  },
  {
    eyebrow: 'Explore',
    title: 'Walk to buildings',
    body: 'In town, move around and approach buildings. The games, verification tools, shop, wardrobe, and profile all live here.',
    route: '/learn',
    selector: '[data-tour="town-world"]',
    hint: 'Use WASD, arrows, touch controls, or drag to look around.',
  },
  {
    eyebrow: 'Verify',
    title: 'Submit content for review',
    body: 'When you find a suspicious post, paste it here and add context so the community can vote and review it.',
    route: '/verify',
    selector: '[data-tour="submit-verification"]',
    hint: 'Text, links, screenshots, and short clips are supported.',
  },
  {
    eyebrow: 'Progress',
    title: 'Track your credibility',
    body: 'Your profile shows credibility, tier, vote weight, and accuracy. Better calls make your future votes count more.',
    route: '/profile',
    selector: '[data-tour="credibility-meter"]',
    hint: 'This is where your fact-checking reputation lives.',
  },
]

export default function UserOnboarding() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null)

  const storageKey = useMemo(() => {
    if (!user) return null
    return `${STORAGE_PREFIX}.${user.id}`
  }, [user])

  const current = steps[step]

  useEffect(() => {
    if (loading || !user || !storageKey) {
      setOpen(false)
      return
    }

    setOpen(window.localStorage.getItem(storageKey) !== '1')
  }, [loading, storageKey, user])

  useEffect(() => {
    if (!open) return
    if (location.pathname !== current.route) {
      navigate(current.route)
    }
  }, [current.route, location.pathname, navigate, open])

  useEffect(() => {
    if (!open || location.pathname !== current.route) return

    let timeoutId = 0
    let frameId = 0
    let attempts = 0
    let scrolledToTarget = false

    const updateTarget = () => {
      const target = document.querySelector<HTMLElement>(current.selector)
      if (!target) {
        attempts += 1
        if (attempts < 20) timeoutId = window.setTimeout(updateTarget, 80)
        else setTargetRect(null)
        return
      }

      if (!scrolledToTarget) {
        scrolledToTarget = true
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
      }
      frameId = window.requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect()
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        })
      })
    }

    updateTarget()
    window.addEventListener('resize', updateTarget)
    window.addEventListener('scroll', updateTarget, true)

    return () => {
      window.clearTimeout(timeoutId)
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateTarget)
      window.removeEventListener('scroll', updateTarget, true)
    }
  }, [current.route, current.selector, location.pathname, open])

  if (!open || !storageKey) return null

  const finish = () => {
    window.localStorage.setItem(storageKey, '1')
    setOpen(false)
  }

  const goToStep = (index: number) => {
    setTargetRect(null)
    setStep(Math.max(0, Math.min(steps.length - 1, index)))
  }

  const isLast = step === steps.length - 1
  const popupStyle = getPopupStyle(targetRect)
  const highlightStyle = getHighlightStyle(targetRect)

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-card/30 backdrop-blur-[1px]" />
      {targetRect && (
        <div
          className="absolute rounded-3xl border-2 border-secondary bg-secondary/10 shadow-[0_0_0_9999px_rgba(21,38,76,0.38),0_0_0_8px_rgba(70,200,189,0.18)] transition-all"
          style={highlightStyle}
        />
      )}

      <section
        className="nz-pop pointer-events-auto fixed w-[calc(100vw-2rem)] max-w-[360px] overflow-hidden rounded-3xl border border-white/20 bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
        style={popupStyle}
      >
        <div className="bg-card px-5 pb-4 pt-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-secondary">{current.eyebrow}</p>
              <h2 className="mt-1 font-display text-xl font-extrabold">{current.title}</h2>
            </div>
            <button
              type="button"
              onClick={finish}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-white/75 transition hover:bg-white/20 hover:text-white"
              aria-label="Close onboarding"
            >
              x
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            {steps.map((item, index) => (
              <button
                key={item.title}
                type="button"
                onClick={() => goToStep(index)}
                aria-label={`Go to onboarding step ${index + 1}`}
                className={`h-1.5 flex-1 rounded-full transition ${
                  index <= step ? 'bg-secondary' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="p-5">
          <p className="text-sm leading-6 text-ink-soft">{current.body}</p>
          <p className="mt-3 rounded-2xl bg-bg px-3 py-2 text-xs font-medium text-card">{current.hint}</p>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={finish}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg hover:text-card"
            >
              Skip tour
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => goToStep(step - 1)}
                  className="rounded-xl border border-black/10 bg-surface px-4 py-2 text-sm font-bold text-card transition hover:bg-bg"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => (isLast ? finish() : goToStep(step + 1))}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-brand-light"
              >
                {isLast ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function getPopupStyle(rect: TargetRect | null): CSSProperties {
  if (!rect) {
    return {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  const margin = 16
  const width = Math.min(POPUP_WIDTH, window.innerWidth - margin * 2)

  if (window.innerWidth < 640) {
    const below = rect.top + rect.height + margin
    const top =
      below + POPUP_HEIGHT_ESTIMATE < window.innerHeight
        ? below
        : Math.max(margin, rect.top - POPUP_HEIGHT_ESTIMATE - margin)

    return {
      left: margin,
      top,
      width,
    }
  }

  const right = rect.left + rect.width + margin
  const left = rect.left - width - margin
  const hasRightRoom = right + width <= window.innerWidth - margin
  const x = hasRightRoom ? right : Math.max(margin, left)
  const y = clamp(rect.top + rect.height / 2 - POPUP_HEIGHT_ESTIMATE / 2, margin, window.innerHeight - POPUP_HEIGHT_ESTIMATE - margin)

  return {
    left: x,
    top: y,
    width,
  }
}

function getHighlightStyle(rect: TargetRect | null): CSSProperties {
  if (!rect) return {}
  const pad = 8
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
