import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const QUESTION_COUNT = 12
const CHALLENGE_SECONDS = 15
const BASE_WIDTH = 220
const BLOCK_HEIGHT = 30
const BLOCK_DEPTH = 74
const MIN_WIDTH = 18
const ROCKET_IMAGES = ['/rocket_1.png', '/rocket_2.png', '/rocket_3.png']

interface CredBreakdown {
  stack_component: number
  stack_milestone_component: number
  fact_check_component: number
  wrong_penalty: number
  capped_award: number
}

type Phase = 'playing' | 'challenge' | 'gameover'
type Verdict = 'Real' | 'Fake'

interface TowerBlock {
  x: number
  width: number
  color: string
}

interface MovingBlock {
  x: number
  width: number
  dir: 1 | -1
}

interface FactScenario {
  id: number
  type: string
  content: string
  verdict: Verdict
  explanation: string
  difficulty: 'easy' | 'medium' | 'hard'
}

interface ChallengeResult {
  correct: boolean
  title: string
  message: string
  explanation: string
}

interface TruthTowerAwardResult {
  credibility_before: number
  credibility_after: number
  credibility_delta: number
  run_credibility_score: number
  run_credibility_breakdown: Record<string, number>
  tier: string
  breakdown: CredBreakdown
}

interface ApiQuestion {
  id: number
  content: string
  type?: string
  correct_answer?: string | null
  difficulty?: string | null
  explanation?: string | null
}

const FALLBACK_SCENARIOS: FactScenario[] = [
  {
    id: 1,
    type: 'Scam message',
    content: 'DBS: Your account will be frozen today. Tap this shortened link to verify your Singpass now.',
    verdict: 'Fake',
    explanation: 'Banks do not ask you to verify accounts through random shortened links. Urgent threats are a common phishing tactic.',
    difficulty: 'easy',
  },
  {
    id: 2,
    type: 'Public notice',
    content: 'The NEA website says dengue clusters are updated regularly and residents should remove stagnant water.',
    verdict: 'Real',
    explanation: 'This matches a normal public-health advisory and points to an official source. It avoids sensational claims.',
    difficulty: 'easy',
  },
  {
    id: 3,
    type: 'Viral headline',
    content: 'Scientists confirm drinking iced water after meals causes cancer, according to a leaked hospital memo.',
    verdict: 'Fake',
    explanation: 'The claim cites a vague leaked memo instead of named research. Big medical claims need reliable medical sources.',
    difficulty: 'medium',
  },
  {
    id: 4,
    type: 'Social post',
    content: 'A photo of a flooded MRT platform is shared as happening today, but the image first appeared online in 2017.',
    verdict: 'Fake',
    explanation: 'Old images are often reused with a new caption. Checking the earliest appearance can reveal the mismatch.',
    difficulty: 'medium',
  },
  {
    id: 5,
    type: 'Civic update',
    content: 'MOH reminds the public to check HealthHub or official ministry channels for vaccination appointment updates.',
    verdict: 'Real',
    explanation: 'The wording is cautious and directs readers to official channels. It does not ask for passwords or payment.',
    difficulty: 'easy',
  },
  {
    id: 6,
    type: 'Manipulated media',
    content: 'A celebrity endorsement video has mismatched lip movement and promises guaranteed crypto profits.',
    verdict: 'Fake',
    explanation: 'Guaranteed investment returns are suspicious, and mismatched speech can signal manipulated video. Verify from the person or company directly.',
    difficulty: 'hard',
  },
]

const palette = ['#233f96', '#46c8bd', '#f3d15c', '#e2823b', '#5ccd7d', '#d56060']

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function formatDelta(value: number) {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`
}

function computeCredBreakdown(score: number, height: number, factChecks: number, correctFactChecks: number): CredBreakdown {
  void score
  const wrongFactChecks = Math.max(0, factChecks - correctFactChecks)
  const stack_component = Math.min(height * 0.01, 0.5)
  const stack_milestone_component = Math.min(Math.floor(height / 10) * 0.05, 0.25)
  const fact_check_component = correctFactChecks * 0.08
  const wrong_penalty = wrongFactChecks * 0.04
  const capped_award = Math.max(
    Math.min(stack_component + stack_milestone_component + fact_check_component - wrong_penalty, 1.25),
    0,
  )
  return {
    stack_component: round2(stack_component),
    stack_milestone_component: round2(stack_milestone_component),
    fact_check_component: round2(fact_check_component),
    wrong_penalty: round2(wrong_penalty),
    capped_award: round2(capped_award),
  }
}

function blockScale(width: number) {
  if (width < 420) return 0.68
  if (width < 560) return 0.78
  return 1
}

export default function TruthTower() {
  const { token, patchUser } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dims = useRef({ w: 720, h: 720, dpr: 1 })
  const blocksRef = useRef<TowerBlock[]>([
    { x: 0, width: BASE_WIDTH, color: '#15264c' },
  ])
  const movingRef = useRef<MovingBlock>({ x: 0, width: BASE_WIDTH, dir: 1 })
  const phaseRef = useRef<Phase>('playing')
  const nextChallengeAt = useRef(5)
  const nextSpawnFromLeft = useRef(true)
  const awardSubmitted = useRef(false)

  const [phase, setPhaseState] = useState<Phase>('playing')
  const [blocks, setBlocks] = useState<TowerBlock[]>(blocksRef.current)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [factChecks, setFactChecks] = useState(0)
  const [correctFactChecks, setCorrectFactChecks] = useState(0)
  const [awardResult, setAwardResult] = useState<TruthTowerAwardResult | null>(null)
  const [awardError, setAwardError] = useState<string | null>(null)
  const [scenarios, setScenarios] = useState<FactScenario[]>(FALLBACK_SCENARIOS)
  const [challenge, setChallenge] = useState<FactScenario | null>(null)
  const [challengeResult, setChallengeResult] = useState<ChallengeResult | null>(null)
  const [timeLeft, setTimeLeft] = useState(CHALLENGE_SECONDS)
  const [birdState, setBirdState] = useState<'incoming' | 'falling' | 'hit'>('incoming')
  const [rocketSrc, setRocketSrc] = useState(ROCKET_IMAGES[0])

  const height = blocks.length - 1
  const speed = Math.min(8.8, 2.8 + height * 0.18)
  const credBreakdown = useMemo(
    () => computeCredBreakdown(score, height, factChecks, correctFactChecks),
    [correctFactChecks, factChecks, height, score],
  )

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  const resetMovingBlock = useCallback((topWidth: number) => {
    const fromLeft = nextSpawnFromLeft.current
    const isMobile = dims.current.w < 560
    const spawnDistance = dims.current.w * (isMobile ? 0.62 : 0.36)
    movingRef.current = {
      x: (fromLeft ? -1 : 1) * spawnDistance,
      width: topWidth,
      dir: fromLeft ? 1 : -1,
    }
  }, [])

  const syncBlocks = useCallback((next: TowerBlock[]) => {
    blocksRef.current = next
    setBlocks(next)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadQuestions() {
      try {
        const res = await fetch(`/api/game/questions/random?count=${QUESTION_COUNT}`)
        if (!res.ok) return
        const data = (await res.json()) as ApiQuestion[]
        const mapped = data
          .map((q, i): FactScenario | null => {
            const raw = q.correct_answer?.toLowerCase()
            if (raw !== 'real' && raw !== 'fake') return null
            return {
              id: q.id,
              type: q.type?.replaceAll('_', ' ') ?? 'Fact check',
              content: q.content,
              verdict: raw === 'real' ? 'Real' : 'Fake',
              explanation: q.explanation ?? FALLBACK_SCENARIOS[i % FALLBACK_SCENARIOS.length].explanation,
              difficulty: q.difficulty === 'hard' || q.difficulty === 'medium' ? q.difficulty : 'easy',
            }
          })
          .filter((q): q is FactScenario => q !== null)

        if (!cancelled && mapped.length > 0) setScenarios(mapped)
      } catch {
        /* local fallback keeps the arcade playable without a backend */
      }
    }

    void loadQuestions()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      dims.current = { w: rect.width, h: rect.height, dpr }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      resetMovingBlock(blocksRef.current.at(-1)?.width ?? BASE_WIDTH)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [resetMovingBlock])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0

    const draw = () => {
      const d = dims.current
      const tower = blocksRef.current
      const moving = movingRef.current
      const isPlaying = phaseRef.current === 'playing'

      if (isPlaying) {
        const mobileSpeedFactor = d.w < 520 ? 0.72 : 1
        moving.x += moving.dir * speed * mobileSpeedFactor
        const scale = blockScale(d.w)
        const mobileOverflow = d.w < 560 ? moving.width * scale * 0.55 : 0
        const edge = d.w * 0.5 - moving.width * scale * 0.5 - 24 + mobileOverflow
        if (moving.x > edge) {
          moving.x = edge
          moving.dir = -1
        }
        if (moving.x < -edge) {
          moving.x = -edge
          moving.dir = 1
        }
      }

      ctx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0)
      ctx.clearRect(0, 0, d.w, d.h)

      const sky = ctx.createLinearGradient(0, 0, 0, d.h)
      sky.addColorStop(0, '#dff3ff')
      sky.addColorStop(0.55, '#d7f0df')
      sky.addColorStop(1, '#fbf3e2')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, d.w, d.h)

      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#ffffff'
      for (let i = 0; i < 4; i += 1) {
        const cx = ((i * 210 + performance.now() * 0.015) % (d.w + 240)) - 120
        const cy = 54 + i * 48
        ctx.beginPath()
        ctx.arc(cx, cy, 26, 0, Math.PI * 2)
        ctx.arc(cx + 32, cy - 7, 34, 0, Math.PI * 2)
        ctx.arc(cx + 70, cy, 23, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      const scale = blockScale(d.w)
      const blockH = BLOCK_HEIGHT * scale
      const baseY = d.h - 78 * scale
      const centerX = d.w / 2
      const visibleCount = d.w < 520 ? 22 : 16
      const visibleBlocks = tower.slice(Math.max(0, tower.length - visibleCount))

      ctx.save()
      ctx.globalAlpha = 0.24
      ctx.filter = 'blur(16px)'
      ctx.fillStyle = 'rgba(11, 27, 58, 0.55)'
      ctx.beginPath()
      ctx.ellipse(
        centerX + 30,
        baseY + blockH + 20 * scale,
        Math.max(120, (visibleBlocks[0]?.width ?? BASE_WIDTH) * 0.68),
        30,
        0,
        0,
        Math.PI * 2,
      )
      ctx.fill()
      ctx.filter = 'none'
      ctx.restore()

      visibleBlocks.forEach((block, i) => {
        const y = baseY - i * blockH
        drawBlock(ctx, centerX + block.x * scale, y, block.width * scale, blockH, block.color)
      })

      if (phaseRef.current === 'playing') {
        const topIndex = visibleBlocks.length
        const movingY = baseY - topIndex * blockH
        drawBlock(ctx, centerX + moving.x * scale, movingY, moving.width * scale, blockH, '#ffffff', true)
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [speed])

  const triggerChallenge = useCallback(() => {
    const pool = scenarios.filter((s) => {
      if (height < 8) return s.difficulty !== 'hard'
      return true
    })
    const picked = pool[Math.floor(Math.random() * pool.length)] ?? FALLBACK_SCENARIOS[0]
    setChallenge(picked)
    setChallengeResult(null)
    setTimeLeft(CHALLENGE_SECONDS)
    setRocketSrc(ROCKET_IMAGES[Math.floor(Math.random() * ROCKET_IMAGES.length)])
    setBirdState('incoming')
    setPhase('challenge')
  }, [height, scenarios, setPhase])

  const damageTower = useCallback(() => {
    const tower = blocksRef.current
    if (tower.length <= 1) return
    const damage = Math.min(34, 14 + Math.floor(height * 1.2))
    const next = tower.map((block, i) => {
      if (i !== tower.length - 1) return block
      const width = Math.max(MIN_WIDTH, block.width - damage)
      return { ...block, width }
    })
    syncBlocks(next)
    resetMovingBlock(next.at(-1)?.width ?? BASE_WIDTH)
  }, [height, resetMovingBlock, syncBlocks])

  const finishChallenge = useCallback(
    (answer: Verdict | 'timeout') => {
      if (!challenge || phaseRef.current !== 'challenge') return
      const correct = answer === challenge.verdict
      setFactChecks((prev) => prev + 1)
      if (correct) {
        setBirdState('falling')
        const nextStreak = streak + 1
        setCorrectFactChecks((prev) => prev + 1)
        setStreak(nextStreak)
        setChallengeResult({
          correct: true,
          title: 'Correct',
          message: '+0.08 fact-check component',
          explanation: challenge.explanation,
        })
      } else {
        setBirdState('hit')
        setStreak(0)
        damageTower()
        setChallengeResult({
          correct: false,
          title: answer === 'timeout' ? "Time's up" : 'Wrong',
          message: `Answer: ${challenge.verdict}`,
          explanation: challenge.explanation,
        })
      }

      window.setTimeout(() => {
        if (phaseRef.current !== 'challenge') return
        nextChallengeAt.current = blocksRef.current.length + 5 + Math.floor(Math.random() * 6)
        setChallenge(null)
        setChallengeResult(null)
        setPhase('playing')
      }, 1700)
    },
    [challenge, damageTower, height, setPhase, streak],
  )

  useEffect(() => {
    if (phase !== 'challenge') return
    if (birdState !== 'incoming') return
    const timer = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer)
          finishChallenge('timeout')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [birdState, finishChallenge, phase])

  const dropBlock = useCallback(() => {
    if (phaseRef.current !== 'playing') return
    const tower = blocksRef.current
    const top = tower[tower.length - 1]
    const moving = movingRef.current
    const left = Math.max(top.x - top.width / 2, moving.x - moving.width / 2)
    const right = Math.min(top.x + top.width / 2, moving.x + moving.width / 2)
    const overlap = right - left

    if (overlap < MIN_WIDTH) {
      setPhase('gameover')
      return
    }

    const newX = (left + right) / 2
    const precision = overlap / top.width
    const perfect = Math.abs(newX - top.x) < 5 && Math.abs(overlap - top.width) < 8
    const gained = Math.round(80 + height * 8 + precision * 90 + (perfect ? 120 : 0))
    const nextTower = [
      ...tower,
      {
        x: newX,
        width: overlap,
        color: palette[tower.length % palette.length],
      },
    ]

    syncBlocks(nextTower)
    setScore((prev) => prev + gained)
    nextSpawnFromLeft.current = !nextSpawnFromLeft.current
    resetMovingBlock(overlap)

    if (nextTower.length >= nextChallengeAt.current) {
      window.setTimeout(triggerChallenge, 300)
    }
  }, [height, resetMovingBlock, setPhase, syncBlocks, triggerChallenge])

  const restart = useCallback(() => {
    const initial = [{ x: 0, width: BASE_WIDTH, color: '#15264c' }]
    syncBlocks(initial)
    nextSpawnFromLeft.current = true
    resetMovingBlock(BASE_WIDTH)
    nextChallengeAt.current = 5
    setScore(0)
    setStreak(0)
    setFactChecks(0)
    setCorrectFactChecks(0)
    setAwardResult(null)
    setAwardError(null)
    awardSubmitted.current = false
    setChallenge(null)
    setChallengeResult(null)
    setBirdState('incoming')
    setTimeLeft(CHALLENGE_SECONDS)
    setPhase('playing')
  }, [resetMovingBlock, setPhase, syncBlocks])

  const handleAction = useCallback(() => {
    if (phaseRef.current === 'playing') dropBlock()
  }, [dropBlock])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        handleAction()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleAction])

  useEffect(() => {
    if (phase !== 'gameover' || awardSubmitted.current || !token) return
    awardSubmitted.current = true
    setAwardError(null)

    async function submitAward() {
      try {
        const res = await fetch('/api/game/sessions/truth-tower/award', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            score,
            height,
            fact_checks: factChecks,
            correct_fact_checks: correctFactChecks,
            wrong_fact_checks: Math.max(0, factChecks - correctFactChecks),
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        const result = (await res.json()) as TruthTowerAwardResult
        setAwardResult(result)
        patchUser({ credibility_score: result.credibility_after, tier: result.tier })
      } catch {
        awardSubmitted.current = false
        setAwardError('Could not add this run to your credibility score.')
      }
    }

    void submitAward()
  }, [correctFactChecks, factChecks, height, patchUser, phase, score, token])

  const towerWidth = Math.round(blocks.at(-1)?.width ?? BASE_WIDTH)
  const bestMetric = useMemo(() => Math.round(score + credBreakdown.capped_award * 400 + height * 60), [credBreakdown.capped_award, height, score])

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#dff3ff] text-card">
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-7 lg:py-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-brand/60">
            Arcade fact-check
          </p>
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Truth Tower</h1>
        </div>
        <div className="hidden sm:order-none sm:flex sm:w-auto sm:flex-wrap sm:gap-2">
          <Hud label="Cred" value={formatDelta(credBreakdown.capped_award)} className="hidden sm:inline-block" />
          <Hud label="Streak" value={String(streak)} className="hidden sm:inline-block" />
        </div>
        <Link
          to="/learn"
          className="rounded-2xl bg-card px-4 py-2 text-sm font-bold text-white shadow-lg shadow-card/20 transition hover:bg-brand"
        >
          Town
        </Link>
      </header>

      <main className="relative z-10 grid min-h-0 flex-1 gap-4 p-3 pt-0 sm:p-4 sm:pt-0 lg:grid-cols-[16rem_1fr_17rem] lg:px-7 lg:pb-7">
        <aside className="hidden rounded-3xl border border-black/5 bg-white/85 p-5 shadow-xl shadow-card/10 backdrop-blur lg:block">
          <PanelTitle eyebrow="Tower deck" title="Run Stats" />
          <div className="mt-4 space-y-3">
            <StatRow label="Tower width" value={`${towerWidth}px`} />
            <StatRow label="Next fact check" value={`${Math.max(0, nextChallengeAt.current - blocks.length + 1)} blocks`} />
            <StatRow label="Final metric" value={String(bestMetric)} />
          </div>
          <p className="mt-5 rounded-2xl bg-secondary/10 p-4 text-sm font-semibold leading-6 text-card/70">
            Stack cleanly to climb higher. Every few blocks, protect the tower by calling a claim Real or Fake.
          </p>
        </aside>

        <section
          ref={wrapRef}
          onPointerDown={(e) => {
            e.preventDefault()
            handleAction()
          }}
          className="relative h-[calc(100dvh-9.5rem)] min-h-[430px] overflow-hidden rounded-3xl bg-white shadow-2xl shadow-card/20 sm:h-[calc(100dvh-10rem)] sm:min-h-[520px] lg:h-auto"
          role="button"
          tabIndex={0}
          aria-label="Tap, click, or press space to drop the moving block"
        >
          <canvas ref={canvasRef} className="block h-full w-full touch-none select-none" />
          {phase === 'challenge' && challenge && (
            <ChallengeOverlay
              birdState={birdState}
              challenge={challenge}
              result={challengeResult}
              rocketSrc={rocketSrc}
              timeLeft={timeLeft}
              onAnswer={finishChallenge}
            />
          )}
          {phase === 'gameover' && (
            <GameOver
              score={score}
              height={height}
              breakdown={awardResult?.breakdown ?? credBreakdown}
              awardResult={awardResult}
              awardError={awardError}
              isLoggedIn={!!token}
              bestMetric={bestMetric}
              onRestart={restart}
            />
          )}
        </section>

        <aside className="hidden rounded-3xl border border-black/5 bg-white/80 p-5 shadow-xl shadow-card/10 backdrop-blur lg:block">
          <PanelTitle eyebrow="Difficulty" title="Scaling" />
          <div className="mt-4 space-y-3 text-sm font-semibold text-card/70">
            <Meter label="Block speed" value={Math.min(100, 28 + height * 4)} />
            <Meter label="Damage" value={Math.min(100, 20 + height * 5)} />
            <Meter label="Difficulty" value={Math.min(100, 24 + height * 6)} />
          </div>
        </aside>
      </main>
    </div>
  )
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  moving = false,
) {
  const depth = Math.max(44, Math.min(BLOCK_DEPTH, w * 0.36))
  const dx = depth * 0.82
  const dy = depth * 0.5
  const half = w / 2
  const top: [number, number][] = [
    [x - half, y],
    [x - half + dx, y - dy],
    [x + half + dx, y - dy],
    [x + half, y],
  ]
  const left: [number, number][] = [
    top[0],
    top[3],
    [top[3][0], top[3][1] + h],
    [top[0][0], top[0][1] + h],
  ]
  const right: [number, number][] = [
    top[3],
    top[2],
    [top[2][0], top[2][1] + h],
    [top[3][0], top[3][1] + h],
  ]

  ctx.save()
  ctx.shadowColor = 'rgba(21,38,76,0.22)'
  ctx.shadowBlur = moving ? 18 : 10
  ctx.shadowOffsetY = moving ? 10 : 6

  fillPolygon(ctx, left, shade(color, -18))
  fillPolygon(ctx, right, shade(color, -34))
  fillPolygon(ctx, top, moving ? '#fbf3e2' : shade(color, 16))

  ctx.restore()
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: [number, number][], color: string) {
  ctx.beginPath()
  points.forEach(([px, py], i) => {
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function shade(hex: string, delta: number) {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const value = Number.parseInt(clean, 16)
  const r = Math.max(0, Math.min(255, (value >> 16) + delta))
  const g = Math.max(0, Math.min(255, ((value >> 8) & 255) + delta))
  const b = Math.max(0, Math.min(255, (value & 255) + delta))
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`
}

function ChallengeOverlay({
  birdState,
  challenge,
  result,
  rocketSrc,
  timeLeft,
  onAnswer,
}: {
  birdState: 'incoming' | 'falling' | 'hit'
  challenge: FactScenario
  result: ChallengeResult | null
  rocketSrc: string
  timeLeft: number
  onAnswer: (answer: Verdict) => void
}) {
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-card/45 p-3 backdrop-blur-sm sm:p-4">
      <div
        className={`absolute top-20 h-24 w-24 transition-all duration-1000 ${
          birdState === 'incoming'
            ? 'right-8 translate-x-0'
            : birdState === 'falling'
              ? 'right-[56%] translate-y-72 -rotate-45 opacity-0'
              : 'right-[50%] translate-y-28 scale-125 -rotate-12'
        }`}
      >
        <img src={rocketSrc} alt="" className="h-full w-full object-contain drop-shadow-xl" />
      </div>

      <div className="grid min-h-full place-items-center py-4">
        {result ? (
          <div
            className={`nz-pop w-full max-w-md rounded-3xl border-4 p-5 text-center shadow-2xl sm:p-6 ${
              result.correct
                ? 'border-risk-low bg-risk-low text-white'
                : 'border-risk-critical bg-risk-critical text-white'
            }`}
            role="alert"
          >
            <p className="text-4xl font-black sm:text-5xl">{result.correct ? 'Correct!' : result.title}</p>
            <p className="mt-2 text-lg font-black sm:text-xl">{result.message}</p>
            <p className="mt-4 rounded-2xl bg-white/18 p-4 text-sm font-semibold leading-6 text-white/92">
              {result.explanation}
            </p>
          </div>
        ) : (
          <div className="nz-pop w-full max-w-lg rounded-3xl border border-white/35 bg-white/95 p-5 text-center shadow-2xl sm:p-6">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-highlight/30 text-2xl font-black text-card sm:h-16 sm:w-16">
              ?
            </div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.28em] text-secondary">
              Fact check event
            </p>
            <h2 className="mt-2 font-display text-xl font-extrabold text-card sm:text-2xl">{challenge.type}</h2>
            <p className="mt-3 max-h-32 overflow-y-auto text-base font-black leading-snug text-card sm:max-h-none sm:text-lg">{challenge.content}</p>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-risk-high transition-all duration-1000"
                style={{ width: `${(timeLeft / CHALLENGE_SECONDS) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-sm font-bold text-ink-soft">{timeLeft}s before impact</p>
            <div className="sticky bottom-0 mt-5 grid grid-cols-2 gap-3 bg-white/95 pt-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAnswer('Real')
                }}
                className="rounded-2xl bg-risk-low py-4 text-base font-black text-white shadow-lg shadow-risk-low/25 transition hover:-translate-y-0.5"
              >
                Real
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAnswer('Fake')
                }}
                className="rounded-2xl bg-risk-critical py-4 text-base font-black text-white shadow-lg shadow-risk-critical/25 transition hover:-translate-y-0.5"
              >
                Fake
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GameOver({
  score,
  height,
  breakdown,
  awardResult,
  awardError,
  isLoggedIn,
  bestMetric,
  onRestart,
}: {
  score: number
  height: number
  breakdown: CredBreakdown
  awardResult: TruthTowerAwardResult | null
  awardError: string | null
  isLoggedIn: boolean
  bestMetric: number
  onRestart: () => void
}) {
  const visibleGrade =
    awardResult?.run_credibility_score ??
    Math.round(Math.max(0, Math.min(1000, 500 + breakdown.capped_award * 100)))

  return (
    <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-white/80 p-4 text-center backdrop-blur-md sm:p-5">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-black/5 bg-white p-4 shadow-2xl shadow-card/20 sm:p-6">
        <p className="hidden text-xs font-black uppercase tracking-[0.28em] text-brand/60 sm:block">Tower collapsed</p>
        <h2 className="font-display text-2xl font-extrabold text-card sm:mt-2 sm:text-4xl">Run complete</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
          <ResultStat label="Height" value={height} />
          <ResultStat label="Score" value={score} />
          <ResultStat label="Cred Grade" value={visibleGrade} />
          <ResultStat label="Metric" value={bestMetric} />
        </div>
        <CredibilityConversion
          score={visibleGrade}
          delta={awardResult?.credibility_delta ?? null}
          breakdown={awardResult?.run_credibility_breakdown ?? null}
        />
        <p className="mt-3 text-sm font-bold leading-5 text-card/70 sm:mt-4">
          {awardResult
            ? `Added to your main credibility: ${awardResult.credibility_before.toFixed(2)} -> ${awardResult.credibility_after.toFixed(2)}`
            : isLoggedIn
              ? awardError ?? 'Adding this run to your main credibility...'
              : 'Log in to add Truth Tower runs to your main credibility.'}
        </p>
        <div className="mt-4 flex gap-3 sm:mt-6">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRestart()
            }}
            className="flex-1 rounded-2xl bg-brand py-3 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light"
          >
            Play again
          </button>
          <Link
            to="/learn"
            className="flex-1 rounded-2xl border border-black/10 bg-white py-3 text-sm font-bold text-card transition hover:bg-bg"
          >
            Town
          </Link>
        </div>
      </div>
    </div>
  )
}

function Hud({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <span className={`rounded-2xl border border-black/5 bg-white/80 px-2 py-2 text-center text-xs shadow-sm backdrop-blur sm:px-4 sm:text-sm ${className}`}>
      <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-brand/55 sm:text-[10px] sm:tracking-[0.18em]">{label}</span>
      <span className="font-black text-card">{value}</span>
    </span>
  )
}

function PanelTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-brand/55">{eyebrow}</p>
      <h2 className="mt-1 font-display text-xl font-extrabold text-card">{title}</h2>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-black/5 pb-2 text-sm">
      <span className="font-semibold text-card/60">{label}</span>
      <span className="font-black text-card">{value}</span>
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full bg-secondary" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function ResultStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-bg p-3 sm:p-4">
      <p className="font-display text-xl font-extrabold text-brand sm:text-2xl">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-soft sm:text-xs">{label}</p>
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
  breakdown: Record<string, number> | null
}) {
  return (
    <div className="mt-4 rounded-3xl bg-bg p-4 text-left sm:mt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand/60">
            Credibility grade
          </p>
          <p className="mt-1 text-xs font-semibold leading-5 text-card/65 sm:text-sm">
            Graded out of 1000. Lower scores give +0, never a deduction.
          </p>
        </div>
        <p className="shrink-0 font-display text-2xl font-extrabold text-brand sm:text-3xl">
          {score}
          <span className="text-sm text-card/45"> /1000</span>
        </p>
      </div>
      {breakdown ? (
        <div className="mt-3 space-y-1.5 text-xs font-semibold text-card/70 sm:space-y-2 sm:text-sm">
          {Object.entries(breakdown).map(([label, value]) => (
            <ConversionRow key={label} label={label} value={String(value)} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-card/55">Calculating run grade...</p>
      )}
      {delta != null && (
        <p className={`mt-3 rounded-2xl bg-white px-4 py-3 text-center text-sm font-black sm:mt-4 ${delta >= 0 ? 'text-risk-low' : 'text-risk-critical'}`}>
          Profile credibility gained +{Math.max(0, delta).toFixed(2)}
        </p>
      )}
    </div>
  )
}

function ConversionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="text-right font-black text-card">{value}</span>
    </div>
  )
}
