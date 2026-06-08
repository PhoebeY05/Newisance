import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
  credibility_before: number | null
  credibility_after: number | null
  credibility_delta: number | null
}

interface Physics {
  birdY: number
  vy: number
  pipeX: number
  scored: boolean
  qStart: number
}

interface Dims {
  w: number
  h: number
  dpr: number
}

const TYPE_LABELS: Record<string, string> = {
  misleading_headline: '📰 Headline',
  deepfake: '🎭 Deepfake suspicion',
  manipulated_media: '🖼️ Image',
  scam_message: '💬 Message',
  satire: '😂 Article',
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
  const { token, user } = useAuth()

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

  // Refs mirror state for use inside the rAF loop (avoids stale closures).
  const phaseRef = useRef<Phase>('loading')
  const qIndexRef = useRef(0)
  // Indices already submitted/scored this round — makes resolveAnswer
  // idempotent so a question can never be counted twice (which otherwise
  // pushed the "Questions" tally past the round total, e.g. 20/10).
  const resolvedRef = useRef<Set<number>>(new Set())
  const sessionIdRef = useRef<number | null>(null)
  const questionsRef = useRef<GameQuestion[]>([])
  const physics = useRef<Physics>({ birdY: 0, vy: 0, pipeX: 0, scored: false, qStart: 0 })
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
    physics.current = { birdY: g.playH / 2, vy: 0, pipeX: g.W, scored: false, qStart: 0 }
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
        setResult(data)
        setScore((prev) => Math.round((prev + data.points_earned) * 100) / 100)
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
      if (res.ok) setSummary((await res.json()) as SessionSummary)
    } catch {
      /* end-screen still shows the local score */
    }
    setPhase('ended')
  }, [apiFetch, setPhase])

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
    physics.current = { birdY: g.playH / 2, vy: 0, pipeX: g.W, scored: false, qStart: 0 }
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

    const drawPipe = (
      x: number,
      yTop: number,
      yBot: number,
      w: number,
      capTop: boolean,
      capBot: boolean,
    ) => {
      ctx.fillStyle = '#57c98a'
      ctx.strokeStyle = '#2f7d52'
      ctx.lineWidth = 3
      ctx.fillRect(x, yTop, w, yBot - yTop)
      ctx.strokeRect(x, yTop, w, yBot - yTop)
      const capH = 16
      const capOver = 7
      if (capTop) {
        ctx.fillRect(x - capOver, yTop, w + capOver * 2, capH)
        ctx.strokeRect(x - capOver, yTop, w + capOver * 2, capH)
      }
      if (capBot) {
        ctx.fillRect(x - capOver, yBot - capH, w + capOver * 2, capH)
        ctx.strokeRect(x - capOver, yBot - capH, w + capOver * 2, capH)
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
        p.pipeX -= g.speed

        if (!p.scored && current) {
          const responseMs = performance.now() - p.qStart
          // Forgiving hitbox: only the bird's core body counts, so a wing tip
          // brushing a pillar edge isn't a crash.
          const hitR = g.birdR * 0.55
          const xOverlap = p.pipeX <= g.birdX + hitR && p.pipeX + g.pipeW >= g.birdX - hitR
          // The bird's core clips a solid pillar segment (ceiling / middle / floor).
          const hitsPillar =
            p.birdY - hitR < upperTop ||
            (p.birdY + hitR > upperBot && p.birdY - hitR < lowerTop) ||
            p.birdY + hitR > lowerBot

          if (xOverlap && hitsPillar) {
            // Crashed into a pillar → forced wrong + penalty.
            p.scored = true
            const chosen: 'Real' | 'Fake' = p.birdY < g.splitY ? 'Real' : 'Fake'
            setPhase('feedback')
            void resolveAnswer(qIndexRef.current, current, chosen, responseMs, true)
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
      sky.addColorStop(0, '#7ec8f0')
      sky.addColorStop(1, '#d6f0fb')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, g.W, g.H)

      drawPipe(p.pipeX, 0, upperTop, g.pipeW, false, true) // ceiling
      drawPipe(p.pipeX, upperBot, lowerTop, g.pipeW, true, true) // middle
      drawPipe(p.pipeX, lowerBot, g.playH, g.pipeW, true, false) // floor

      // Gap labels
      ctx.textAlign = 'center'
      ctx.font = `italic bold ${Math.round(g.birdR * 1.1)}px Inter, sans-serif`
      ctx.fillStyle = '#2f7d52'
      ctx.fillText('REAL', p.pipeX + g.pipeW / 2, g.upperC + 6)
      ctx.fillStyle = '#c1332b'
      ctx.fillText('FAKE', p.pipeX + g.pipeW / 2, g.lowerC + 6)

      // Ground
      ctx.fillStyle = '#7ac043'
      ctx.fillRect(0, g.playH, g.W, 8)
      ctx.fillStyle = '#b4671f'
      ctx.fillRect(0, g.playH + 8, g.W, g.groundH - 8)

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
    <div className="flex h-screen flex-col overflow-hidden bg-card text-white">
      {/* Top HUD */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-2">
          <img src="/bird_avatar.png" alt="" className="h-7 w-7 object-contain" />
          <span className="font-display text-xl font-extrabold">Timed Challenge</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Hud label="Score" value={String(score)} />
          <Hud label="Question" value={`${Math.min(qIndex + 1, totalQuestions)}/${totalQuestions}`} />
          <Hud label="Streak" value={String(streak)} />
          <Hud label="Accuracy" value={`${accuracyPct}%`} />
        </div>
        <Link
          to="/learn"
          className="rounded-xl bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/20"
        >
          Quit
        </Link>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[15rem_1fr_16rem]">
        {/* Left — live stats */}
        <aside className="hidden rounded-3xl bg-white/5 p-5 ring-1 ring-white/10 lg:block">
          <h3 className="font-display text-lg font-extrabold">📊 Stats</h3>
          <ul className="mt-4 space-y-3 text-sm">
            <StatRow label="Questions" value={`${answered}/${totalQuestions}`} />
            <StatRow label="Accuracy" value={`${accuracyPct}%`} />
            <StatRow label="Current streak" value={String(streak)} />
            <StatRow label="Score" value={String(score)} />
          </ul>
          {user && (
            <div className="mt-4 rounded-2xl bg-white/5 p-3 text-center ring-1 ring-white/10">
              <p className="text-xs text-white/50">Credibility</p>
              <p className="font-display text-xl font-extrabold text-secondary">
                {Math.round(user.credibility_score)}
              </p>
            </div>
          )}
        </aside>

        {/* Center — game canvas */}
        <section
          ref={containerRef}
          className="relative overflow-hidden rounded-3xl bg-sky-200 ring-1 ring-white/10"
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
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
              <div
                key={qIndex}
                className="nz-pop max-w-md rounded-2xl bg-card/85 px-4 py-2 text-center text-sm shadow-lg ring-1 ring-white/10 backdrop-blur"
              >
                <span className="font-semibold text-secondary">
                  {TYPE_LABELS[current.type] ?? '📰 Content'}
                </span>
                <span className="mx-2 text-white/40">·</span>
                <span className="text-white/90">{current.content}</span>
                <span className="mt-1 block text-[11px] text-white/50">
                  Fly UP into REAL · DOWN into FAKE
                </span>
              </div>
            </div>
          )}

          {phase === 'loading' && <Overlay>Loading game…</Overlay>}
          {phase === 'error' && (
            <Overlay>
              <p className="font-bold text-risk-high">Couldn't start the game</p>
              <p className="mt-1 text-sm text-white/70">{error}</p>
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
        <aside className="hidden rounded-3xl bg-white/5 p-5 ring-1 ring-white/10 lg:block">
          <h3 className="font-display text-lg font-extrabold">⚡ Power-Ups</h3>
          <ul className="mt-4 space-y-3">
            {POWERUPS.map((pu) => (
              <li key={pu.title} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{pu.emoji}</span>
                  <span className="text-sm font-semibold">{pu.title}</span>
                </div>
                <p className="mt-1 text-xs text-white/50">{pu.status}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-[11px] text-white/30">Coming soon</p>
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
  const label = TYPE_LABELS[question.type] ?? '📰 Content'
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-card/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-surface p-5 text-ink shadow-2xl ring-4 ring-brand-light/40">
        <div className="flex items-center justify-between border-b border-black/10 pb-2">
          <span className="text-sm font-extrabold text-risk-med">⚠️ IDENTIFY THIS</span>
          <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-ink-soft">
            {label}
          </span>
        </div>
        {question.media_url ? (
          <img
            src={question.media_url}
            alt="Content under review"
            className="mt-3 max-h-48 w-full rounded-xl object-cover"
          />
        ) : (
          <div className="mt-3 grid place-items-center rounded-xl bg-bg py-6 text-center">
            <span className="text-3xl">{label.split(' ')[0]}</span>
          </div>
        )}
        <p className="mt-3 text-base font-semibold leading-relaxed text-ink">{question.content}</p>
        <div className="mt-3 rounded-xl bg-bg p-2 text-center text-sm font-bold text-brand">
          💭 Is this REAL or FAKE?
        </div>
        <p className="mt-3 text-center text-xs text-ink-soft">
          Tap or press <kbd className="rounded bg-bg px-1">Space</kbd> to fly. Steer the bird through
          the <span className="font-bold text-risk-low">REAL</span> gap (up) or{' '}
          <span className="font-bold text-risk-critical">FAKE</span> gap (down).
        </p>
        <button
          onClick={onStart}
          className="mt-4 w-full rounded-xl bg-brand py-3 text-sm font-bold text-white transition hover:bg-brand-light"
        >
          {isFirst ? 'Start flying →' : 'Continue flying →'}
        </button>
      </div>
    </div>
  )
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-card/85 p-6 text-center">
      <div>{children}</div>
    </div>
  )
}

function FeedbackOverlay({ result }: { result: AnswerResult }) {
  // Clean pass not yet graded by the backend → neutral "Checking…" overlay
  // (a crash is shown straight away since we already know it's a crash).
  if (result.pending && !result.crashed) {
    return (
      <div className="absolute inset-0 z-20 grid place-items-center bg-card/85 p-6 text-center" role="status">
        <p className="animate-pulse font-display text-3xl font-extrabold text-white">Checking…</p>
      </div>
    )
  }
  const title = result.crashed ? '💥 Crashed!' : result.is_correct ? '✅ Correct!' : '❌ Wrong'
  return (
    <div
      className={`absolute inset-0 z-20 grid place-items-center p-6 text-center ${
        result.is_correct ? 'bg-risk-low/90' : 'bg-risk-critical/90'
      }`}
      role="alert"
    >
      <div className="max-w-sm">
        <p className="font-display text-4xl font-extrabold">{title}</p>
        {result.crashed && (
          <p className="mt-2 text-sm font-bold text-white">
            Flew into a pillar · −{CRASH_PENALTY} pts
          </p>
        )}
        {result.correct_answer && (
          <p className="mt-2 text-sm font-semibold text-white/90">Answer: {result.correct_answer}</p>
        )}
        {!result.crashed && result.points_earned > 0 && (
          <p className="mt-1 text-lg font-extrabold">+{result.points_earned} pts</p>
        )}
        {result.explanation && (
          <p className="mt-3 text-sm leading-relaxed text-white/90">{result.explanation}</p>
        )}
        <p className="mt-4 text-xs text-white/70">Continuing…</p>
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
    <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-card/95 p-6 text-center">
      <div className="w-full max-w-md">
        <h2 className="font-display text-4xl font-extrabold">Round complete!</h2>
        <div className="mt-6 grid grid-cols-2 gap-3">
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

        {/* Share */}
        <div className="mt-6 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <button
            onClick={() => void share()}
            className="w-full rounded-xl bg-secondary py-3 text-sm font-bold text-card transition hover:opacity-90"
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
                className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold ring-1 ring-white/15 transition hover:bg-white/15"
              >
                View card
              </a>
            )}
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="flex-1 rounded-xl bg-brand py-3 text-sm font-bold hover:bg-brand-light"
          >
            Play again
          </button>
          <Link
            to="/leaderboard"
            className="flex-1 rounded-xl border border-white/20 py-3 text-sm font-bold hover:bg-white/10"
          >
            View leaderboard
          </Link>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-risk-low' : tone === 'bad' ? 'text-risk-high' : 'text-white'
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <p className={`font-display text-2xl font-extrabold ${color}`}>{value}</p>
      <p className="text-xs text-white/60">{label}</p>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between border-b border-white/10 pb-2">
      <span className="text-white/60">{label}</span>
      <span className="font-bold">{value}</span>
    </li>
  )
}

function Hud({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-xl bg-white/10 px-4 py-1.5 text-center text-sm ring-1 ring-white/10">
      <span className="block text-[10px] uppercase tracking-wide text-white/50">{label}</span>
      <span className="font-display font-extrabold">{value}</span>
    </span>
  )
}

const POWERUPS = [
  { emoji: '🛡️', title: 'Shield', status: 'Next: 100 pts' },
  { emoji: '👁️', title: 'Highlight Key Words', status: 'Next: 150 pts' },
  { emoji: '⏰', title: 'Slow Motion', status: 'Next: 300 pts' },
  { emoji: '⭐', title: 'Double Points', status: 'Next: 500 pts' },
]
