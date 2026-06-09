import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { gameMediaUrl, isVideoMedia } from '../lib/media'
import { EMPTY_POWERUPS, POWERUP_META } from '../lib/powerups'

/**
 * Timed Challenge — single-player Flappy-Bird-style misinformation game
 * (Phase 3). Wired to the game-service:
 *   POST   /api/game/sessions               → start a session
 *   GET    /api/game/questions/random        → fetch the round's questions
 *   POST   /api/game/sessions/:id/answer     → score each answer
 *   POST   /api/game/sessions/:id/end        → final summary + credibility
 *
 * Mechanic: each round opens with a question popup; the player taps to start
 * flying. Each question is an obstacle with two gaps — an upper REAL gap and a
 * lower FAKE gap. Gravity pulls the bird down; tap / space flaps it up. Fly
 * through the gap that matches your verdict. Whichever gap the bird is in when
 * it crosses the obstacle is the submitted answer, then an answer popup shows
 * the result before the next question's popup. A 10-question round always
 * completes.
 */

const API = '/api/game'
const QUESTION_COUNT = 10
const CRASH_PENALTY = 100

type Phase = 'loading' | 'error' | 'ready' | 'playing' | 'feedback' | 'ended'

interface GameQuestion {
  id: number
  content: string
  type: string
  media_url: string | null
  difficulty: string | null
  tags: string[]
}

interface AnswerResult {
  is_correct: boolean
  correct_answer: string | null
  explanation: string | null
  points_earned: number
  crashed?: boolean
  // True while the /answer POST is still in flight (shows a "Checking…" overlay
  // so there's never a blank frame between impact and the graded result).
  pending?: boolean
}

interface SessionSummary {
  session_id: number
  score: number
  total_answers: number
  correct_answers: number
  accuracy: number
  run_credibility_score: number | null
  run_credibility_breakdown: Record<string, number>
  credibility_before: number | null
  credibility_after: number | null
  credibility_delta: number | null
  tier: string | null
}

interface Physics {
  birdY: number
  vy: number
  pipeX: number
  scored: boolean
  qStart: number
  // Set when a Shield absorbs a pillar hit, so the rest of this obstacle is
  // passed through without crashing (it resolves by gap on clearing).
  shielded: boolean
}

interface Dims {
  w: number
  h: number
  dpr: number
}

const TYPE_LABELS: Record<string, string> = {
  misleading_headline: '📰 Headline',
  deepfake: '🎭 Deepfake check',
  manipulated_media: '🖼️ Image evidence',
  scam_message: '💬 Message check',
  satire: 'Satire check',
}

// Layout geometry derived from the live canvas size each frame.
function geometry(d: Dims) {
  const W = d.w
  const H = d.h
  const groundH = Math.min(60, Math.max(24, H * 0.05))
  const playH = H - groundH
  const birdR = Math.min(42, Math.max(18, Math.min(W, H) * 0.04))
  const pipeW = Math.min(140, Math.max(72, W * 0.12))
  const gapH = Math.min(320, Math.max(birdR * 5.6, playH * 0.26))
  const upperC = playH * 0.3
  const lowerC = playH * 0.72
  return {
    W,
    H,
    groundH,
    playH,
    birdR,
    birdX: W * 0.26,
    pipeW,
    gapH,
    upperC,
    lowerC,
    splitY: (upperC + lowerC) / 2,
    speed: Math.min(5.5, Math.max(1.9, W * 0.0032)),
    gravity: Math.min(0.42, Math.max(0.2, playH * 0.0006)),
    flapV: -Math.min(8, Math.max(5, playH * 0.0105)),
    maxVy: Math.min(9, Math.max(5, playH * 0.011)),
  }
}

export default function TimedChallenge() {
  const { token, user, patchUser } = useAuth()

  const [phase, setPhaseState] = useState<Phase>('loading')
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [qIndex, setQIndexState] = useState(0)
  const [score, setScore] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [streak, setStreak] = useState(0)
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Power-ups: owned counts (from the shop) + which effects are active this
  // round. `active.shield` means "armed"; it flips off when it absorbs a crash.
  const [owned, setOwned] = useState<Record<string, number>>({})
  const [active, setActive] = useState<Record<string, boolean>>({ ...EMPTY_POWERUPS })
  const ownedRef = useRef<Record<string, number>>({})
  ownedRef.current = owned
  // Mirror of `active` for the rAF loop (avoids stale closures).
  const pwRef = useRef<Record<string, boolean>>({ ...EMPTY_POWERUPS })

  // Refs mirror state for use inside the rAF loop (avoids stale closures).
  const phaseRef = useRef<Phase>('loading')
  const qIndexRef = useRef(0)
  // Indices already submitted/scored this round — makes resolveAnswer
  // idempotent so a question can never be counted twice (which otherwise
  // pushed the "Questions" tally past the round total, e.g. 20/10).
  const resolvedRef = useRef<Set<number>>(new Set())
  const sessionIdRef = useRef<number | null>(null)
  const questionsRef = useRef<GameQuestion[]>([])
  const physics = useRef<Physics>({ birdY: 0, vy: 0, pipeX: 0, scored: false, qStart: 0, shielded: false })
  const dims = useRef<Dims>({ w: 360, h: 520, dpr: 1 })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const birdImg = useRef<HTMLImageElement | null>(null)
  const birdReady = useRef(false)
  const tokenRef = useRef<string | null>(token)
  tokenRef.current = token

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  const apiFetch = useCallback((path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (tokenRef.current) headers.set('Authorization', `Bearer ${tokenRef.current}`)
    if (init.body) headers.set('Content-Type', 'application/json')
    return fetch(`${API}${path}`, { ...init, headers })
  }, [])

  // Load the bird avatar sprite.
  useEffect(() => {
    const img = new Image()
    img.src = '/bird_avatar.png'
    img.onload = () => {
      birdReady.current = true
    }
    birdImg.current = img
  }, [])

  // Keep the canvas backing store sized to its container (crisp on HiDPI).
  useEffect(() => {
    const section = containerRef.current
    const canvas = canvasRef.current
    if (!section || !canvas) return
    const resize = () => {
      const rect = section.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      dims.current = { w: rect.width, h: rect.height, dpr }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(section)
    return () => ro.disconnect()
  }, [])

  // Set up the very first question: bird centred, waiting for the first tap.
  const setupRound = useCallback(() => {
    qIndexRef.current = 0
    resolvedRef.current = new Set()
    setQIndexState(0)
    const g = geometry(dims.current)
    physics.current = { birdY: g.playH / 2, vy: 0, pipeX: g.W, scored: false, qStart: 0, shielded: false }
    setPhase('ready')
  }, [setPhase])

  // ---- bootstrap: create session + load questions ----------------------
  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const [sessionRes, questionsRes] = await Promise.all([
          apiFetch('/sessions', { method: 'POST', body: JSON.stringify({ mode: 'timed' }) }),
          apiFetch(`/questions/random?count=${QUESTION_COUNT}`),
        ])
        if (!sessionRes.ok) throw new Error('Could not start a game session')
        if (!questionsRes.ok) throw new Error('Could not load questions')
        const session = (await sessionRes.json()) as { id: number }
        const loaded = (await questionsRes.json()) as GameQuestion[]
        if (cancelled) return
        if (loaded.length === 0) throw new Error('No questions available yet — try seeding the database')
        sessionIdRef.current = session.id
        questionsRef.current = loaded
        setQuestions(loaded)
        setupRound()
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setPhase('error')
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [apiFetch, setPhase, setupRound])

  // Load the player's owned power-ups (logged-in users only).
  useEffect(() => {
    if (!token) return
    let cancelled = false
    apiFetch('/shop/inventory')
      .then(async (r) => {
        if (r.ok) {
          const inv = (await r.json()) as Record<string, number>
          if (!cancelled) setOwned(inv)
        }
      })
      .catch(() => {
        /* no power-ups is fine */
      })
    return () => {
      cancelled = true
    }
  }, [apiFetch, token])

  // Activate a power-up: spend one from inventory + flip its effect on for the
  // round (Shield arms until it absorbs a crash).
  const activatePowerup = useCallback(
    (key: string) => {
      if (pwRef.current[key]) return // already active / armed
      if ((ownedRef.current[key] ?? 0) <= 0) return
      pwRef.current[key] = true
      setActive((a) => ({ ...a, [key]: true }))
      setOwned((o) => ({ ...o, [key]: (o[key] ?? 0) - 1 }))
      void apiFetch('/shop/consume', { method: 'POST', body: JSON.stringify({ key }) }).catch(() => {
        /* best-effort; the round still gets the effect */
      })
    },
    [apiFetch],
  )

  const resolveAnswer = useCallback(
    async (
      qIdx: number,
      question: GameQuestion,
      chosen: 'Real' | 'Fake',
      responseMs: number,
      crashed: boolean,
    ) => {
      const sessionId = sessionIdRef.current
      if (sessionId == null) return
      // Idempotency guard: only ever score a given question once, even if the
      // render loop fires this twice for the same obstacle.
      if (resolvedRef.current.has(qIdx)) return
      resolvedRef.current.add(qIdx)

      // Show an overlay IMMEDIATELY (same tick as setPhase('feedback')) so the
      // game never freezes on a blank frame while the POST is in flight. A
      // crash is known up front; a clean pass shows "Checking…" until graded.
      setResult(
        crashed
          ? { is_correct: false, correct_answer: null, explanation: null, points_earned: 0, crashed: true }
          : { is_correct: false, correct_answer: null, explanation: null, points_earned: 0, pending: true },
      )

      // Submit to record the attempt + retrieve the explanation/correct answer.
      let data: AnswerResult = { is_correct: false, correct_answer: null, explanation: null, points_earned: 0 }
      try {
        const res = await apiFetch(`/sessions/${sessionId}/answer`, {
          method: 'POST',
          body: JSON.stringify({
            question_id: question.id,
            chosen_answer: chosen,
            response_ms: Math.round(responseMs),
            crashed,
          }),
        })
        if (res.ok) data = (await res.json()) as AnswerResult
      } catch {
        /* keep the neutral default */
      }

      if (crashed) {
        // Hit a pillar → forced wrong, no points, and a penalty deduction.
        setResult({ ...data, is_correct: false, points_earned: 0, crashed: true })
        setScore((prev) => Math.round((prev - CRASH_PENALTY) * 100) / 100)
        setAnswered((prev) => prev + 1)
        setStreak(0)
      } else {
        // Double Points doubles the round's earnings (client-side score tally).
        const earned = Math.round(data.points_earned * (pwRef.current.double ? 2 : 1) * 100) / 100
        setResult({ ...data, points_earned: earned })
        setScore((prev) => Math.round((prev + earned) * 100) / 100)
        setAnswered((prev) => prev + 1)
        setCorrect((prev) => prev + (data.is_correct ? 1 : 0))
        setStreak((prev) => (data.is_correct ? prev + 1 : 0))
      }
    },
    [apiFetch],
  )

  const endGame = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (sessionId == null) return
    try {
      const res = await apiFetch(`/sessions/${sessionId}/end`, { method: 'POST' })
      if (res.ok) {
        const data = (await res.json()) as SessionSummary
        setSummary(data)
        if (data.credibility_after != null) {
          patchUser({ credibility_score: data.credibility_after, ...(data.tier ? { tier: data.tier } : {}) })
        }
      }
    } catch {
      /* end-screen still shows the local score */
    }
    setPhase('ended')
  }, [apiFetch, patchUser, setPhase])

  // Advance to the next obstacle. Each round opens with the question popup
  // (the 'ready' phase), so reset the bird to centre and wait for the player
  // to read the question and tap to start flying.
  const nextQuestion = useCallback(() => {
    const next = qIndexRef.current + 1
    if (next >= questionsRef.current.length) {
      void endGame()
      return
    }
    qIndexRef.current = next
    setQIndexState(next)
    const g = geometry(dims.current)
    physics.current = { birdY: g.playH / 2, vy: 0, pipeX: g.W, scored: false, qStart: 0, shielded: false }
    setPhase('ready')
  }, [endGame, setPhase])

  const advance = useCallback(() => {
    if (phaseRef.current !== 'feedback') return
    setResult(null)
    nextQuestion()
  }, [nextQuestion])

  useEffect(() => {
    if (phase !== 'feedback') return
    // Don't start the auto-advance countdown until the answer has been graded.
    // Otherwise a slow /answer POST lets the 3s timer fire while the "Checking…"
    // overlay is still up, skipping the ✅/❌ result entirely.
    if (result?.pending) return
    const timer = window.setTimeout(advance, 3000)
    return () => window.clearTimeout(timer)
  }, [phase, advance, result])

  // ---- input -----------------------------------------------------------
  const flap = useCallback(() => {
    const p = phaseRef.current
    const g = geometry(dims.current)
    if (p === 'ready') {
      physics.current.qStart = performance.now()
      physics.current.vy = g.flapV
      setPhase('playing')
      return
    }
    if (p === 'playing') physics.current.vy = g.flapV
    if (p === 'feedback') advance()
  }, [advance, setPhase])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        flap()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flap])

  // ---- game loop -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0

    const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
      const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
      ctx.beginPath()
      ctx.moveTo(x + radius, y)
      ctx.lineTo(x + w - radius, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
      ctx.lineTo(x + w, y + h - radius)
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
      ctx.lineTo(x + radius, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
      ctx.lineTo(x, y + radius)
      ctx.quadraticCurveTo(x, y, x + radius, y)
      ctx.closePath()
    }

    const drawPipe = (
      x: number,
      yTop: number,
      yBot: number,
      w: number,
      capTop: boolean,
      capBot: boolean,
    ) => {
      const h = yBot - yTop
      const grad = ctx.createLinearGradient(x, yTop, x + w, yBot)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.45, '#c6f5ea')
      grad.addColorStop(1, '#72d7c1')
      ctx.fillStyle = grad
      ctx.strokeStyle = 'rgba(20, 96, 86, 0.48)'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(13, 148, 136, 0.24)'
      ctx.shadowBlur = 16
      roundedRect(x, yTop, w, h, 18)
      ctx.fill()
      ctx.stroke()
      ctx.shadowBlur = 0
      const capH = 16
      const capOver = 9
      ctx.fillStyle = '#123c42'
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      if (capTop) {
        roundedRect(x - capOver, yTop, w + capOver * 2, capH, 9)
        ctx.fill()
        ctx.stroke()
      }
      if (capBot) {
        roundedRect(x - capOver, yBot - capH, w + capOver * 2, capH, 9)
        ctx.fill()
        ctx.stroke()
      }
    }

    const drawBird = (x: number, y: number, r: number, vy: number) => {
      const img = birdImg.current
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(Math.max(-0.5, Math.min(0.9, vy * 0.04)))
      if (birdReady.current && img) {
        const w = r * 3
        const h = (w * img.naturalHeight) / (img.naturalWidth || 1)
        ctx.drawImage(img, -w / 2, -h / 2, w, h)
      } else {
        ctx.fillStyle = '#f3d15c'
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    const draw = () => {
      const d = dims.current
      const g = geometry(d)
      const p = physics.current
      const current = questionsRef.current[qIndexRef.current]
      const playing = phaseRef.current === 'playing'
      const upperTop = g.upperC - g.gapH / 2
      const upperBot = g.upperC + g.gapH / 2
      const lowerTop = g.lowerC - g.gapH / 2
      const lowerBot = g.lowerC + g.gapH / 2

      if (phaseRef.current === 'ready') {
        p.birdY = g.playH / 2
        p.vy = 0
        p.pipeX = g.W
      }

      if (playing) {
        p.vy += g.gravity
        if (p.vy > g.maxVy) p.vy = g.maxVy
        p.birdY += p.vy
        if (p.birdY < g.birdR) {
          p.birdY = g.birdR
          p.vy = 0
        }
        if (p.birdY > g.playH - g.birdR) {
          p.birdY = g.playH - g.birdR
          p.vy = 0
        }
        // Slow Motion power-up: obstacles drift in at 60% speed.
        p.pipeX -= g.speed * (pwRef.current.slowmo ? 0.6 : 1)

        if (!p.scored && current) {
          const responseMs = performance.now() - p.qStart
          // Forgiving hitbox: only the bird's core body counts, so a wing tip
          // brushing a pillar edge isn't a crash. Featherweight shrinks it more.
          const hitR = g.birdR * (pwRef.current.shrink ? 0 : 0.55)
          const xOverlap = p.pipeX <= g.birdX + hitR && p.pipeX + g.pipeW >= g.birdX - hitR
          // The bird's core clips a solid pillar segment (ceiling / middle / floor).
          const hitsPillar =
            p.birdY - hitR < upperTop ||
            (p.birdY + hitR > upperBot && p.birdY - hitR < lowerTop) ||
            p.birdY + hitR > lowerBot

          if (xOverlap && hitsPillar && !p.shielded) {
            if (pwRef.current.shield) {
              // Shield absorbs the hit: pass through this obstacle (it then
              // resolves by whichever gap the bird clears).
              p.shielded = true
              pwRef.current.shield = false
              setActive((a) => ({ ...a, shield: false }))
            } else {
              // Crashed into a pillar → forced wrong + penalty.
              p.scored = true
              const chosen: 'Real' | 'Fake' = p.birdY < g.splitY ? 'Real' : 'Fake'
              setPhase('feedback')
              void resolveAnswer(qIndexRef.current, current, chosen, responseMs, true)
            }
          } else if (p.pipeX + g.pipeW <= g.birdX) {
            // Cleared the obstacle through a gap → that gap is the answer.
            p.scored = true
            const inUpper = p.birdY >= upperTop && p.birdY <= upperBot
            const inLower = p.birdY >= lowerTop && p.birdY <= lowerBot
            const chosen: 'Real' | 'Fake' = inUpper
              ? 'Real'
              : inLower
                ? 'Fake'
                : p.birdY < g.splitY
                  ? 'Real'
                  : 'Fake'
            setPhase('feedback')
            void resolveAnswer(qIndexRef.current, current, chosen, responseMs, false)
          }
        }
      }

      // ---- render ----
      ctx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0)
      const sky = ctx.createLinearGradient(0, 0, 0, g.playH)
      sky.addColorStop(0, '#d7efd9')
      sky.addColorStop(0.46, '#a8dfe0')
      sky.addColorStop(1, '#d9eee7')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, g.W, g.H)

      // Soft drifting clouds give the game a breezy "fact courier" identity.
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.fillStyle = '#ffffff'
      for (let i = 0; i < 5; i += 1) {
        const cx = ((i * 210 + (performance.now() * 0.018)) % (g.W + 260)) - 130
        const cy = 58 + (i % 3) * 52
        ctx.beginPath()
        ctx.arc(cx, cy, 26, 0, Math.PI * 2)
        ctx.arc(cx + 28, cy - 8, 34, 0, Math.PI * 2)
        ctx.arc(cx + 66, cy, 24, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      drawPipe(p.pipeX, 0, upperTop, g.pipeW, false, true) // ceiling
      drawPipe(p.pipeX, upperBot, lowerTop, g.pipeW, true, true) // middle
      drawPipe(p.pipeX, lowerBot, g.playH, g.pipeW, true, false) // floor

      // Gap labels
      ctx.textAlign = 'center'
      ctx.font = `900 ${Math.round(g.birdR * 1.08)}px Inter, sans-serif`
      ctx.fillStyle = '#0f766e'
      ctx.fillText('REAL', p.pipeX + g.pipeW / 2, g.upperC + 6)
      ctx.fillStyle = '#be123c'
      ctx.fillText('FAKE', p.pipeX + g.pipeW / 2, g.lowerC + 6)

      // Ground
      const ground = ctx.createLinearGradient(0, g.playH, 0, g.H)
      ground.addColorStop(0, '#23bda9')
      ground.addColorStop(1, '#0f4b48')
      ctx.fillStyle = ground
      ctx.fillRect(0, g.playH, g.W, g.groundH)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(0, g.playH, g.W, 4)

      drawBird(g.birdX, p.birdY, g.birdR, p.vy)

      // Dev-only telemetry so E2E tests can steer the bird through a gap
      // (closed-loop) instead of fighting the physics blindly. Stripped from
      // production builds — `import.meta.env.DEV` is false in `vite build`.
      if (import.meta.env.DEV) {
        ;(window as unknown as { __nzGame?: unknown }).__nzGame = {
          phase: phaseRef.current,
          birdY: p.birdY,
          realGapTop: upperTop,
          realGapBottom: upperBot,
          fakeGapTop: lowerTop,
          fakeGapBottom: lowerBot,
          realCenter: g.upperC,
          fakeCenter: g.lowerC,
        }
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [setPhase, resolveAnswer])

  // ---- UI --------------------------------------------------------------
  const current = questions[qIndex]
  const totalQuestions = questions.length || QUESTION_COUNT
  const accuracyPct = answered ? Math.round((correct / answered) * 100) : 0

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#e8e5d4] text-[#18383a]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_8%,rgba(250,204,21,0.22),transparent_28%),radial-gradient(circle_at_84%_16%,rgba(20,184,166,0.2),transparent_24%),linear-gradient(180deg,#f3eed9,#d6ece6_48%,#eee7d8)]" />
      {/* Top HUD */}
      <header className="relative z-10 flex flex-col gap-2.5 px-3 py-2.5 sm:px-5 sm:py-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-4 lg:px-7">
        <div className="flex items-center justify-between gap-2 lg:justify-start lg:gap-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/88 shadow-lg shadow-teal-900/14 ring-1 ring-teal-900/14 backdrop-blur sm:h-12 sm:w-12 sm:rounded-2xl">
              <img src="/bird_avatar.png" alt="" className="h-6 w-6 object-contain sm:h-9 sm:w-9" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-teal-700/75 sm:text-[10px] sm:tracking-[0.36em]">
                Fact flight
              </p>
              <h1 className="truncate text-lg font-black tracking-tight text-[#123c42] sm:text-2xl">
                Timed Challenge
              </h1>
            </div>
          </div>
          {/* Quit lives next to the title on mobile; the lg layout moves it to the far right. */}
          <Link
            to="/learn"
            className="shrink-0 rounded-full border border-teal-900/14 bg-white/76 px-3 py-1.5 text-xs font-black text-[#123c42] shadow-sm transition hover:bg-white lg:hidden"
          >
            Quit
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2.5 lg:flex lg:flex-wrap lg:gap-3">
          <Hud label="Score" value={String(score)} />
          <Hud label="Question" value={`${Math.min(qIndex + 1, totalQuestions)}/${totalQuestions}`} />
          <Hud label="Streak" value={String(streak)} />
          <Hud label="Accuracy" value={`${accuracyPct}%`} />
        </div>
        <Link
          to="/learn"
          className="hidden rounded-full border border-teal-900/14 bg-white/76 px-4 py-2 text-sm font-black text-[#123c42] shadow-sm transition hover:bg-white lg:block"
        >
          Quit
        </Link>
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 gap-4 p-2.5 pt-0 sm:p-4 sm:pt-0 lg:grid-cols-[15rem_1fr_16rem] lg:px-7 lg:pb-7">
        {/* Left — live stats */}
        <aside className="hidden rounded-[1.75rem] border border-teal-900/14 bg-white/78 p-5 shadow-xl shadow-teal-950/14 backdrop-blur-xl lg:block">
          <ul className="mt-4 space-y-3 text-sm">
            <StatRow label="Questions" value={`${answered}/${totalQuestions}`} />
            <StatRow label="Accuracy" value={`${accuracyPct}%`} />
            <StatRow label="Current streak" value={String(streak)} />
            <StatRow label="Score" value={String(score)} />
          </ul>
          {user && (
            <div className="mt-5 rounded-3xl border border-teal-900/14 bg-gradient-to-br from-white to-teal-100 p-4 text-center shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-teal-800/55">Credibility</p>
              <p className="mt-1 text-3xl font-black text-teal-700">
                {user.credibility_score.toFixed(2)}
              </p>
            </div>
          )}
        </aside>

        {/* Center — game canvas */}
        <section
          ref={containerRef}
          className="relative overflow-hidden rounded-[2rem] border border-teal-900/18 bg-sky-100 shadow-2xl shadow-teal-950/24 ring-1 ring-teal-900/14"
          onPointerDown={(e) => {
            e.preventDefault()
            flap()
          }}
          role="button"
          tabIndex={0}
          aria-label="Tap to fly the bird up. Steer it through the REAL gap (top) or FAKE gap (bottom)."
        >
          <canvas ref={canvasRef} className="block h-full w-full touch-none select-none" />

          {/* Reminder banner while flying — keeps the question in view so the
              player can recall what they're judging. */}
          {phase === 'playing' && current && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2 sm:p-3">
              <div
                key={qIndex}
                className="nz-pop max-w-xl rounded-2xl border border-teal-900/14 bg-white/88 px-3 py-2 text-center text-xs text-[#123c42] shadow-xl shadow-teal-950/16 backdrop-blur-xl sm:rounded-3xl sm:px-5 sm:py-3 sm:text-sm"
              >
                <span className="font-black text-teal-700">
                  {TYPE_LABELS[current.type] ?? 'Content'}
                </span>
                <span className="mx-1.5 text-teal-900/30 sm:mx-2">·</span>
                <span className="font-semibold text-[#123c42] line-clamp-2 sm:line-clamp-none">{current.content}</span>
                <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700/60 sm:text-[11px] sm:tracking-[0.22em]">
                  Up for real · down for fake
                </span>
              </div>
            </div>
          )}

          {phase === 'loading' && <Overlay>Loading game…</Overlay>}
          {phase === 'error' && (
            <Overlay>
              <p className="font-bold text-risk-high">Couldn't start the game</p>
              <p className="mt-1 text-sm text-slate-600">{error}</p>
            </Overlay>
          )}
          {phase === 'ready' && current && (
            <IdentifyCard question={current} onStart={flap} isFirst={qIndex === 0} />
          )}
          {phase === 'feedback' && result && <FeedbackOverlay result={result} />}
          {phase === 'ended' && (
            <EndOverlay
              score={score}
              accuracyPct={accuracyPct}
              correct={correct}
              total={answered}
              summary={summary}
              sessionId={sessionIdRef.current}
            />
          )}
        </section>

        {/* Right — power-ups (cosmetic) */}
        <aside className="hidden rounded-[1.75rem] border border-teal-900/14 bg-white/72 p-5 shadow-xl shadow-teal-950/14 backdrop-blur-xl lg:block">
          <h3 className="font-display text-lg font-extrabold">⚡ Power-Ups</h3>
          <ul className="mt-4 space-y-3">
            {POWERUP_META.map((pu) => {
              const count = owned[pu.key] ?? 0
              const isActive = active[pu.key]
              const canUse = count > 0 && !isActive
              return (
                <li key={pu.key} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{pu.emoji}</span>
                      <span className="text-sm font-semibold">{pu.name}</span>
                    </div>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold">×{count}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-semibold leading-4 text-white/55">
                    {pu.timedEffect}
                  </p>
                  <button
                    onClick={() => activatePowerup(pu.key)}
                    disabled={!canUse}
                    className={`mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      isActive
                        ? 'bg-secondary/20 text-secondary'
                        : canUse
                          ? 'bg-brand text-white hover:bg-brand-light'
                          : 'cursor-not-allowed bg-white/5 text-white/30'
                    }`}
                  >
                    {isActive ? (pu.kind === 'armed' ? '🛡 Armed' : '● Active') : count > 0 ? 'Activate' : 'None — visit shop'}
                  </button>
                </li>
              )
            })}
          </ul>
          <Link
            to="/shop"
            className="mt-4 block rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-bold ring-1 ring-white/10 transition hover:bg-white/20"
          >
            ⚡ Buy more in the shop →
          </Link>
        </aside>
      </div>
    </div>
  )
}

function IdentifyCard({
  question,
  onStart,
  isFirst,
}: {
  question: GameQuestion
  onStart: () => void
  isFirst: boolean
}) {
  const label = TYPE_LABELS[question.type] ?? 'Content'
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-teal-950/28 p-2.5 backdrop-blur-sm sm:p-4">
      <div className="flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-3xl border border-teal-900/16 bg-white/92 text-[#123c42] shadow-2xl shadow-teal-950/28 backdrop-blur-xl sm:max-w-2xl sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center justify-between border-b border-teal-900/12 bg-gradient-to-r from-teal-100 to-amber-100 px-4 py-2.5 sm:px-5 sm:py-4">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-700 sm:text-xs sm:tracking-[0.28em]">
            IDENTIFY THIS
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-teal-800 shadow-sm ring-1 ring-teal-900/12 sm:px-3 sm:text-xs">
            {label}
          </span>
        </div>
        {question.media_url && (
          <div className="mx-3 mt-3 h-36 overflow-hidden rounded-2xl bg-white/70 shadow-lg sm:mx-5 sm:mt-5 sm:h-52 sm:rounded-3xl">
            {isVideoMedia(question.media_url) ? (
              <video
                src={gameMediaUrl(question.media_url)}
                controls
                playsInline
                className="h-full w-full bg-black object-contain"
              />
            ) : (
              <img
                src={gameMediaUrl(question.media_url)}
                alt="Content under review"
                className="h-full w-full object-contain"
              />
            )}
          </div>
        )}
        <p className="mt-3 px-8 text-base font-black leading-snug text-[#123c42] sm:mt-4 sm:px-5 sm:text-xl">
          {question.content}
        </p>
        <div className="mx-4 mt-3 rounded-xl border border-teal-900/12 bg-teal-100 p-2.5 text-center text-xs font-black uppercase tracking-[0.14em] text-teal-800 sm:mx-5 sm:mt-4 sm:rounded-2xl sm:p-3 sm:text-sm sm:tracking-[0.18em]">
          💭 Is this REAL or FAKE?
        </div>
        <p className="mx-4 mt-2.5 text-center text-[11px] font-semibold leading-5 text-slate-500 sm:mx-5 sm:mt-3 sm:text-xs">
          Tap or press <kbd className="rounded bg-teal-50 px-1">Space</kbd> to fly. Steer through the{' '}
          <span className="font-bold text-risk-low">REAL</span> gap (up) or{' '}
          <span className="font-bold text-risk-critical">FAKE</span> gap (down).
        </p>
        <button
          onClick={onStart}
          className="mx-4 mb-4 mt-3 shrink-0 rounded-2xl bg-[#123c42] py-3 text-sm font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-teal-950/20 transition hover:-translate-y-0.5 hover:bg-teal-700 sm:mx-5 sm:mb-5 sm:mt-5 sm:py-4 sm:tracking-[0.2em]"
        >
          {isFirst ? 'Start flying →' : 'Continue flying →'}
        </button>
      </div>
    </div>
  )
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-white/72 p-6 text-center text-[#123c42] backdrop-blur-sm">
      <div>{children}</div>
    </div>
  )
}

function FeedbackOverlay({ result }: { result: AnswerResult }) {
  // Clean pass not yet graded by the backend → neutral "Checking…" overlay
  // (a crash is shown straight away since we already know it's a crash).
  if (result.pending && !result.crashed) {
    return (
      <div className="absolute inset-0 z-20 grid place-items-center bg-white/72 p-6 text-center backdrop-blur-sm" role="status">
        <p className="animate-pulse text-3xl font-black text-[#123c42]">Checking...</p>
      </div>
    )
  }
  const title = result.crashed ? '💥 Crashed!' : result.is_correct ? '✅ Correct!' : '❌ Wrong'
  return (
    <div
      className={`absolute inset-0 z-20 grid place-items-center p-6 text-center backdrop-blur-sm ${
        result.is_correct ? 'bg-emerald-400/82' : 'bg-rose-400/82'
      }`}
      role="alert"
    >
      <div className="max-w-sm rounded-[2rem] border border-white/55 bg-white/90 p-6 text-[#123c42] shadow-2xl">
        <p className="text-4xl font-black">{title}</p>
        {result.crashed && (
          <p className="mt-2 text-sm font-black text-rose-700">
            Flew into a pillar · −{CRASH_PENALTY} pts
          </p>
        )}
        {result.correct_answer && (
          <p className="mt-2 text-sm font-black text-teal-800">Answer: {result.correct_answer}</p>
        )}
        {!result.crashed && result.points_earned > 0 && (
          <p className="mt-1 text-lg font-black text-emerald-700">+{result.points_earned} pts</p>
        )}
        {result.explanation && (
          <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-600">{result.explanation}</p>
        )}
        <p className="mt-4 text-xs font-black uppercase tracking-[0.24em] text-teal-700/55">Continuing...</p>
      </div>
    </div>
  )
}

function EndOverlay({
  score,
  accuracyPct,
  correct,
  total,
  summary,
  sessionId,
}: {
  score: number
  accuracyPct: number
  correct: number
  total: number
  summary: SessionSummary | null
  sessionId: number | null
}) {
  const delta = summary?.credibility_delta ?? null
  const [copied, setCopied] = useState(false)

  const appUrl = window.location.origin
  const shareText = `I scored ${score} on Newisance! Can you beat me?`
  const cardUrl = sessionId != null ? `/api/game/share/card/${sessionId}` : null
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${appUrl}`)}`
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(appUrl)}&text=${encodeURIComponent(shareText)}`

  async function share() {
    const data = { title: 'Newisance', text: shareText, url: appUrl }
    if (navigator.share) {
      try {
        await navigator.share(data)
        return
      } catch {
        /* user cancelled or unsupported → fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${appUrl}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the WhatsApp/Telegram buttons still work */
    }
  }

  return (
    <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-white/78 p-4 text-center text-[#123c42] backdrop-blur-md sm:p-6">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[1.75rem] border border-teal-900/16 bg-white/92 p-4 shadow-2xl shadow-teal-950/24 sm:rounded-[2rem] sm:p-6">
        <p className="hidden text-xs font-black uppercase tracking-[0.34em] text-teal-700/65 sm:block">Flight log</p>
        <h2 className="text-3xl font-black sm:mt-2 sm:text-4xl">Round complete!</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
          <Stat value={String(score)} label="Score" />
          <Stat value={`${accuracyPct}%`} label="Accuracy" />
          <Stat value={`${correct}/${total}`} label="Correct" />
          {delta != null && (
            <Stat
              value={`${delta >= 0 ? '+' : ''}${Math.round(delta * 100) / 100}`}
              label="Credibility"
              tone={delta >= 0 ? 'good' : 'bad'}
            />
          )}
        </div>

        {summary?.run_credibility_score != null && (
          <CredibilityConversion
            score={summary.run_credibility_score}
            delta={summary.credibility_delta}
            breakdown={summary.run_credibility_breakdown}
          />
        )}

        {/* Share */}
        <div className="mt-4 rounded-3xl border border-teal-900/12 bg-teal-50/82 p-3 shadow-sm sm:mt-6 sm:p-4">
          <button
            onClick={() => void share()}
            className="w-full rounded-2xl bg-[#123c42] py-3 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-teal-700"
          >
            {copied ? '✓ Copied to clipboard' : '🔗 Share your result'}
          </button>
          <div className="mt-3 flex items-center justify-center gap-3">
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              aria-label="Share on WhatsApp"
              className="grid h-10 w-10 place-items-center rounded-full bg-[#25D366]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
              </svg>
            </a>
            <a
              href={tgHref}
              target="_blank"
              rel="noreferrer"
              aria-label="Share on Telegram"
              className="grid h-10 w-10 place-items-center rounded-full bg-[#229ED9]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
            </a>
            {cardUrl && (
              <a
                href={cardUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white px-4 py-2 text-xs font-black text-teal-800 shadow-sm ring-1 ring-teal-900/12 transition hover:bg-teal-50"
              >
                View card
              </a>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-3 sm:mt-6">
          <button
            onClick={() => window.location.reload()}
            className="flex-1 rounded-2xl bg-teal-600 py-3 text-sm font-black text-white shadow-lg shadow-teal-900/16 transition hover:bg-teal-700"
          >
            Play again
          </button>
          <Link
            to="/leaderboard"
            className="flex-1 rounded-2xl border border-teal-900/15 bg-white py-3 text-sm font-black text-teal-800 transition hover:bg-teal-50"
          >
            View leaderboard
          </Link>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-[#123c42]'
  return (
    <div className="rounded-2xl border border-teal-900/12 bg-white/76 p-3 shadow-sm sm:rounded-3xl">
      <p className={`text-xl font-black sm:text-2xl ${color}`}>{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-800/46 sm:text-xs sm:tracking-[0.18em]">{label}</p>
    </div>
  )
}

function CredibilityConversion({
  score,
  delta,
  breakdown,
}: {
  score: number
  delta: number | null
  breakdown: Record<string, number>
}) {
  const tone = delta == null ? 'text-[#123c42]' : delta >= 0 ? 'text-emerald-700' : 'text-rose-700'
  const entries = Object.entries(breakdown)
  return (
    <div className="mt-4 rounded-3xl border border-teal-900/12 bg-teal-50/82 p-4 text-left shadow-sm sm:mt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-800/55">Credibility grade</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600 sm:text-sm">
            This practice round is graded out of 1000. Lower scores give +0, never a deduction.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-black text-teal-700 sm:text-3xl">{score}</p>
          <p className="text-xs font-black text-teal-800/50">/ 1000</p>
        </div>
      </div>
      {entries.length > 0 && (
        <div className="mt-3 space-y-1.5 sm:mt-4 sm:space-y-2">
          {entries.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 text-xs font-semibold text-[#123c42] sm:text-sm">
              <span>{label}</span>
              <span className="font-black">{value}</span>
            </div>
          ))}
        </div>
      )}
      {delta != null && (
        <p className={`mt-4 rounded-2xl bg-white/76 px-4 py-3 text-center text-sm font-black ${tone}`}>
          Profile credibility gained +{Math.max(0, delta).toFixed(2)}
        </p>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between border-b border-teal-900/12 pb-2 text-[#123c42]">
      <span className="font-semibold text-teal-800/62">{label}</span>
      <span className="font-black">{value}</span>
    </li>
  )
}

function Hud({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-xl border border-teal-900/12 bg-white/74 px-1.5 py-1.5 text-center text-sm text-[#123c42] shadow-sm backdrop-blur sm:rounded-2xl sm:px-4 sm:py-2">
      <span className="block text-[8px] font-black uppercase tracking-[0.12em] text-teal-800/48 sm:text-[10px] sm:tracking-[0.2em]">
        {label}
      </span>
      <span className="text-sm font-black sm:text-base">{value}</span>
    </span>
  )
}

