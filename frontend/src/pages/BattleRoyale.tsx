import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { gameMediaUrl } from '../lib/media'

const TYPE_LABELS: Record<string, string> = {
  misleading_headline: 'Misleading headline',
  deepfake: 'Deepfake check',
  manipulated_media: 'Manipulated media',
  scam_message: 'Scam message',
  satire: 'Satire or real',
}

type FeedTone = 'info' | 'success' | 'warning' | 'danger'

const FEED_TONE_STYLES: Record<FeedTone, string> = {
  info: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-50',
  success: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50',
  warning: 'border-amber-300/35 bg-amber-300/10 text-amber-50',
  danger: 'border-rose-300/35 bg-rose-300/10 text-rose-50',
}

interface PlayerRow {
  user_id: number
  username: string
  score: number
  lives: number
  alive: boolean
  total_answers?: number
  correct_answers?: number
}

interface QuestionView {
  id: number
  content: string
  type: string
  media_url: string | null
  difficulty: string | null
  index: number
  total: number
}

interface AnswerResultMsg {
  is_correct: boolean
  correct_answer: string | null
  points_earned: number
  score: number
  lives?: number
  reason?: string
}

interface Standing {
  rank: number
  user_id: number
  username: string
  score: number
  lives: number
  alive: boolean
  total_answers?: number
  correct_answers?: number
  question_total?: number
  run_credibility_score?: number
  run_credibility_breakdown?: Record<string, number>
  credibility_before?: number
  credibility_after?: number
  credibility_delta?: number
  tier?: string
}

interface FeedItem {
  id: number
  kind: string
  tone: FeedTone
  text: string
  createdAt: number
}

function formatFeedTime(createdAt: number) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  if (diffSeconds < 5) return 'Now'
  if (diffSeconds < 60) return `${diffSeconds}s`
  return `${Math.floor(diffSeconds / 60)}m`
}

export default function BattleRoyale() {
  const { user, token, loginAsGuest, patchUser } = useAuth()

  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<'waiting' | 'active' | 'finished'>('waiting')
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [question, setQuestion] = useState<QuestionView | null>(null)
  const [durationMs, setDurationMs] = useState(10000)
  const [answered, setAnswered] = useState(false)
  const [result, setResult] = useState<AnswerResultMsg | null>(null)
  const [standings, setStandings] = useState<Standing[] | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [startDeadline, setStartDeadline] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [questionDeadline, setQuestionDeadline] = useState<number | null>(null)
  const [questionTimeLeftMs, setQuestionTimeLeftMs] = useState<number | null>(null)
  const [impactUserId, setImpactUserId] = useState<number | null>(null)
  const [guestLoading, setGuestLoading] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const feedId = useRef(0)
  const userRef = useRef(user)
  const patchUserRef = useRef(patchUser)
  const localBattleStatsRef = useRef({ total: 0, correct: 0, questionTotal: 10, countedQuestionIds: new Set<number>() })
  const pendingQuestionIdRef = useRef<number | null>(null)
  userRef.current = user
  patchUserRef.current = patchUser

  const appendFeed = useCallback((item: Omit<FeedItem, 'id'>) => {
    feedId.current += 1
    setFeed((prev) => [{ id: feedId.current, ...item }, ...prev].slice(0, 18))
  }, [])

  useEffect(() => {
    if (!token) return
    let closed = false
    localBattleStatsRef.current = { total: 0, correct: 0, questionTotal: 10, countedQuestionIds: new Set<number>() }
    pendingQuestionIdRef.current = null

    async function connect() {
      try {
        const joinRes = await fetch('/api/game/battle/join', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!joinRes.ok) throw new Error('Could not join a battle room')
        const { ws_url } = (await joinRes.json()) as { room_id: string; ws_url: string }
        if (closed) return

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(
          `${proto}://${window.location.host}/api/game${ws_url}?token=${encodeURIComponent(token!)}`,
        )
        wsRef.current = ws

        ws.onopen = () => setConnected(true)
        ws.onclose = () => setConnected(false)
        ws.onerror = () => setError('Connection error')
        ws.onmessage = (event) => {
          if (wsRef.current !== ws) return
          const msg = JSON.parse(event.data as string)
          switch (msg.type) {
            case 'room_state':
              setStatus(msg.status)
              setPlayers(msg.players)
              setStartDeadline(
                typeof msg.starts_in_ms === 'number' ? Date.now() + msg.starts_in_ms : null,
              )
              break
            case 'feed_event':
              if (msg.kind === 'answer_correct' || msg.kind === 'game_over') break
              appendFeed({
                kind: msg.kind ?? 'event',
                tone: msg.tone ?? 'info',
                text: msg.text ?? '',
                createdAt: Date.now(),
              })
              break
            case 'answer_correct':
              appendFeed({
                kind: 'correct',
                tone: 'success',
                text: `${msg.username} banked +${Math.round(msg.points_earned)} points`,
                createdAt: Date.now(),
              })
              break
            case 'player_damaged':
              setImpactUserId(msg.user_id)
              window.setTimeout(() => setImpactUserId(null), 700)
              appendFeed({
                kind: 'heart lost',
                tone: 'warning',
                text: `${msg.username} lost a heart. ${msg.lives} remaining.`,
                createdAt: Date.now(),
              })
              break
            case 'player_eliminated':
              setImpactUserId(msg.user_id)
              window.setTimeout(() => setImpactUserId(null), 700)
              appendFeed({
                kind: 'eliminated',
                tone: 'danger',
                text: `${msg.username} has been eliminated`,
                createdAt: Date.now(),
              })
              break
            case 'new_question':
              appendFeed({
                kind: 'round live',
                tone: 'info',
                text: `Round ${msg.index + 1} of ${msg.total} is live`,
                createdAt: Date.now(),
              })
              setStatus('active')
              setQuestion({ ...msg.question, index: msg.index, total: msg.total })
              localBattleStatsRef.current.questionTotal = msg.total
              setDurationMs(msg.duration_ms)
              setQuestionDeadline(Date.now() + msg.duration_ms)
              setAnswered(false)
              setResult(null)
              pendingQuestionIdRef.current = null
              break
            case 'answer_result':
              {
                const currentQuestionId = pendingQuestionIdRef.current ?? question?.id ?? null
                if (currentQuestionId != null && !localBattleStatsRef.current.countedQuestionIds.has(currentQuestionId)) {
                  localBattleStatsRef.current.countedQuestionIds.add(currentQuestionId)
                  localBattleStatsRef.current.total += 1
                  if (msg.is_correct) localBattleStatsRef.current.correct += 1
                }
                pendingQuestionIdRef.current = null
              }
              setResult(msg)
              break
            case 'game_over':
              setStandings(mergeLocalBattleStats(msg.standings as Standing[], userRef.current?.id, localBattleStatsRef.current))
              setStatus('finished')
              if (userRef.current) {
                const mine = (msg.standings as Standing[]).find((s) => s.user_id === userRef.current?.id)
                if (mine?.credibility_after != null) {
                  patchUserRef.current({ credibility_score: mine.credibility_after, ...(mine.tier ? { tier: mine.tier } : {}) })
                }
                void fetch('/api/community/users/me', {
                  headers: { Authorization: `Bearer ${token}` },
                })
                  .then(async (res) => {
                    if (!res.ok) return
                    const freshUser = await res.json()
                    patchUserRef.current({
                      credibility_score: freshUser.credibility_score,
                      tier: freshUser.tier,
                    })
                  })
                  .catch(() => {
                    /* WebSocket result still carries the match summary. */
                  })
              }
              break
            default:
              break
          }
        }
      } catch (err) {
        if (!closed) setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    }

    void connect()
    return () => {
      closed = true
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onmessage = null
        ws.onopen = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
    }
  }, [token, appendFeed])

  useEffect(() => {
    if (status !== 'waiting' || startDeadline == null) {
      setSecondsLeft(null)
      return
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((startDeadline - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [status, startDeadline])

  useEffect(() => {
    if (status !== 'active' || questionDeadline == null) {
      setQuestionTimeLeftMs(null)
      return
    }
    const tick = () => setQuestionTimeLeftMs(Math.max(0, questionDeadline - Date.now()))
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [status, questionDeadline])

  const me = user ? players.find((p) => p.user_id === user.id) : undefined
  const aliveCount = players.filter((p) => p.alive).length
  const eliminated = me ? !me.alive : false
  const progress = Math.max(0, Math.min(100, (((questionTimeLeftMs ?? durationMs) / durationMs) || 0) * 100))
  const questionSecondsLeft = Math.max(0, Math.ceil(((questionTimeLeftMs ?? durationMs) / 1000) || 0))

  const arenaState = useMemo(() => {
    if (status === 'waiting') return 'Queue forming'
    if (status === 'finished') return 'Match complete'
    if (eliminated) return 'Spectating'
    if (answered) return 'Locked in'
    return 'Choose your verdict'
  }, [answered, eliminated, status])

  const submit = (answer: 'Real' | 'Fake') => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !question || answered || eliminated) return
    pendingQuestionIdRef.current = question.id
    ws.send(JSON.stringify({ type: 'submit_answer', question_id: question.id, answer }))
    setAnswered(true)
  }

  const handleGuestLogin = async () => {
    setError(null)
    setGuestLoading(true)
    try {
      await loginAsGuest()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guest login failed')
    } finally {
      setGuestLoading(false)
    }
  }

  if (!token) {
    return (
      <Shell>
        <main className="grid min-h-screen place-items-center px-6">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-black/35 p-8 text-center shadow-2xl shadow-cyan-950/40 backdrop-blur-xl">
            <p className="text-xs font-bold uppercase tracking-[0.45em] text-cyan-200">Live arena</p>
            <h1 className="mt-4 text-4xl font-black text-white">Battle Royale</h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Enter with two hearts. Answer fast, survive longer, and outlast the room.
            </p>
            {error && (
              <p className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm font-bold text-rose-100">
                {error}
              </p>
            )}
            <button
              onClick={() => void handleGuestLogin()}
              disabled={guestLoading}
              className="mt-7 w-full rounded-2xl bg-cyan-300 px-5 py-4 text-sm font-black uppercase tracking-[0.22em] text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {guestLoading ? 'Entering...' : 'Enter as guest'}
            </button>
            <Link to="/login" className="mt-4 block text-sm font-semibold text-cyan-200 hover:text-white">
              Log in instead
            </Link>
          </div>
        </main>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-5 py-5 lg:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.45em] text-cyan-200/80">Newisance live</p>
          <h1 className="mt-1 text-2xl font-black tracking-wide text-white lg:text-4xl">Battle Royale</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={connected ? 'success' : 'warning'}>{connected ? 'Connected' : 'Connecting'}</StatusPill>
          <StatusPill tone="info">{aliveCount} alive</StatusPill>
          <StatusPill tone={eliminated ? 'danger' : 'success'}>{me ? `${me.lives} hearts` : '2 hearts'}</StatusPill>
          <Link
            to="/learn"
            className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white/85 transition hover:bg-white/20"
          >
            Quit
          </Link>
        </div>
      </header>

      <main className="relative z-10 grid flex-1 gap-5 px-5 pb-6 lg:grid-cols-[18rem_1fr_20rem] lg:px-8">
        <aside className="rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <PanelTitle eyebrow="Survivors" title="Roster" />
          <ul className="mt-4 space-y-2">
            {players.map((p, i) => (
              <li
                key={p.user_id}
                className={`group rounded-2xl border px-3 py-3 transition duration-300 ${
                  user && p.user_id === user.id
                    ? 'border-cyan-300/50 bg-cyan-300/15 shadow-lg shadow-cyan-950/30'
                    : 'border-white/10 bg-black/20'
                } ${impactUserId === p.user_id ? 'scale-[1.02] border-rose-300/70 bg-rose-400/15' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-xs font-black text-white/70">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-white">
                      {p.username}
                      {user && p.user_id === user.id ? ' (you)' : ''}
                    </p>
                    <p className="text-xs font-semibold text-cyan-100/60">{Math.round(p.score)} pts</p>
                  </div>
                  <HeartRow lives={p.lives} />
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      p.alive ? 'bg-gradient-to-r from-emerald-300 to-cyan-300' : 'bg-rose-400/70'
                    }`}
                    style={{ width: p.alive ? `${Math.max(18, p.lives * 50)}%` : '100%' }}
                  />
                </div>
              </li>
            ))}
            {players.length === 0 && <li className="text-sm text-slate-400">Waiting for challengers.</li>}
          </ul>
        </aside>

        <section className="min-h-[68vh] rounded-[2rem] border border-white/10 bg-black/25 p-4 shadow-2xl shadow-cyan-950/25 backdrop-blur-xl lg:p-6">
          {error && <p className="mb-4 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm font-bold text-rose-100">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.42em] text-white/40">{arenaState}</p>
              <p className="mt-1 text-sm font-semibold text-slate-300">
                {status === 'active' && question
                  ? `Round ${question.index + 1} of ${question.total}`
                  : status === 'waiting'
                    ? `${players.length} joined. Starts at 2 players.`
                    : 'Final standings locked.'}
              </p>
            </div>
            {status === 'active' && (
              <div className="relative grid h-20 w-20 place-items-center rounded-full bg-white/10">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `conic-gradient(rgb(103 232 249) ${progress * 3.6}deg, rgba(255,255,255,0.1) 0deg)`,
                  }}
                />
                <div className="relative grid h-16 w-16 place-items-center rounded-full bg-slate-950/90">
                  <span className="text-xl font-black tabular-nums text-white">{questionSecondsLeft}</span>
                </div>
              </div>
            )}
          </div>

          {status === 'waiting' && (
            <div className="grid min-h-[46vh] place-items-center text-center">
              <div>
                <div className="mx-auto grid h-32 w-32 place-items-center rounded-full border border-cyan-200/20 bg-cyan-200/10 shadow-2xl shadow-cyan-500/10">
                  <span className="text-6xl font-black tabular-nums text-cyan-100">{secondsLeft ?? '--'}</span>
                </div>
                <h2 className="mt-8 text-3xl font-black text-white">Arena is warming up</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-300">
                  The match launches automatically when enough players enter. Bring two hearts; spend them carefully.
                </p>
              </div>
            </div>
          )}

          {status === 'active' && question && (
            <div className="mt-5">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-amber-200 to-rose-300 transition-[width] duration-100 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-6 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white text-slate-950 shadow-2xl shadow-black/30">
                {question.media_url && (
                  <img src={gameMediaUrl(question.media_url)} alt="Content under review" className="h-56 w-full object-contain" />
                )}
                <div className="p-6 lg:p-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-white">
                      {TYPE_LABELS[question.type] ?? 'Content'}
                    </span>
                    {question.difficulty && (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-amber-900">
                        {question.difficulty}
                      </span>
                    )}
                  </div>
                  <p className="mt-5 text-lg font-black leading-tight lg:text-xl">{question.content}</p>
                </div>
              </div>

              {eliminated ? (
                <div className="mt-5 rounded-3xl border border-rose-300/25 bg-rose-400/10 p-5 text-center">
                  <p className="text-lg font-black text-rose-100">You are spectating</p>
                  <p className="mt-1 text-sm text-rose-100/70">The arena continues until one player remains.</p>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <VerdictButton
                    tone="fake"
                    disabled={answered}
                    label="Fake"
                    sublabel="Call the bluff"
                    onClick={() => submit('Fake')}
                  />
                  <VerdictButton
                    tone="real"
                    disabled={answered}
                    label="Real"
                    sublabel="Trust the signal"
                    onClick={() => submit('Real')}
                  />
                </div>
              )}

              {result && (
                <div
                  className={`mt-5 rounded-3xl border px-5 py-4 text-sm font-bold ${
                    result.is_correct
                      ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
                      : 'border-rose-300/30 bg-rose-400/10 text-rose-100'
                  }`}
                >
                  {result.is_correct
                    ? `Correct. +${Math.round(result.points_earned)} points secured.`
                    : `Hit taken. Correct answer: ${result.correct_answer}.`}
                </div>
              )}
              {answered && !result && <p className="mt-5 text-center text-sm font-semibold text-slate-400">Verdict locked. Waiting for the room.</p>}
            </div>
          )}

          {status === 'finished' && standings && <Podium standings={standings} meId={user?.id} />}
        </section>

        <aside className="rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <PanelTitle eyebrow="Signal stream" title="Live Feed" />
          <ul className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            {feed.map((f) => (
              <li key={f.id} className={`rounded-2xl border px-3 py-3 ${FEED_TONE_STYLES[f.tone] ?? FEED_TONE_STYLES.info}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] opacity-60">{f.kind.replaceAll('_', ' ')}</p>
                    <p className="mt-1 text-sm font-semibold leading-5">{f.text}</p>
                  </div>
                  <span className="shrink-0 text-xs font-bold opacity-50">{formatFeedTime(f.createdAt)}</span>
                </div>
              </li>
            ))}
            {feed.length === 0 && <li className="text-sm text-slate-400">Match events will appear here.</li>}
          </ul>
        </aside>
      </main>
    </Shell>
  )
}

function Podium({ standings, meId }: { standings: Standing[]; meId?: number }) {
  const winner = standings[0]
  const mine = standings.find((s) => s.user_id === meId)
  return (
    <div className="mx-auto mt-4 max-h-[calc(100dvh-8rem)] w-full max-w-2xl overflow-y-auto px-1 text-center sm:mt-8 sm:max-h-none sm:overflow-visible sm:px-0">
      <p className="hidden text-xs font-bold uppercase tracking-[0.45em] text-cyan-200 sm:block">Final signal</p>
      <h2 className="text-3xl font-black text-white sm:mt-3 sm:text-5xl">Match complete</h2>
      {winner && <p className="mt-2 text-sm font-bold text-cyan-100 sm:mt-3 sm:text-lg">{winner.username} survived the arena.</p>}
      <ul className="mt-4 grid gap-2 text-left sm:mt-8 sm:gap-3">
        {standings.slice(0, 8).map((s) => (
          <li
            key={s.user_id}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-3 sm:gap-4 sm:rounded-3xl sm:px-5 sm:py-4 ${
              s.user_id === meId ? 'border-cyan-300/50 bg-cyan-300/15' : 'border-white/10 bg-white/5'
            }`}
          >
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-white/10 text-base font-black text-white sm:h-10 sm:w-10 sm:text-lg">
              {s.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-black text-white">
                {s.username}
                {s.user_id === meId ? ' (you)' : ''}
              </p>
              <p className="text-xs font-semibold text-slate-400">{s.alive ? 'Survivor' : 'Eliminated'}</p>
            </div>
            <HeartRow lives={s.lives} />
            <span className="text-sm font-black text-cyan-100">{Math.round(s.score)}</span>
          </li>
        ))}
      </ul>
      {mine && (
        <CredibilityConversion
          standing={mine}
          summary={buildBattleCredibilitySummary(mine)}
          delta={mine.credibility_delta ?? null}
        />
      )}
      <div className="mt-4 flex gap-3 sm:mt-7">
        <button onClick={() => window.location.reload()} className="flex-1 rounded-2xl bg-cyan-300 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-950 transition hover:bg-white sm:py-4 sm:text-sm sm:tracking-[0.18em]">
          Play again
        </button>
        <Link to="/leaderboard" className="flex-1 rounded-2xl border border-white/15 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-white/10 sm:py-4 sm:text-sm sm:tracking-[0.18em]">
          Leaderboard
        </Link>
      </div>
    </div>
  )
}

function CredibilityConversion({
  standing,
  summary,
  delta,
}: {
  standing: Standing
  summary: BattleCredibilitySummary
  delta: number | null
}) {
  const accuracy = standing.total_answers
    ? Math.round(((standing.correct_answers ?? 0) / standing.total_answers) * 100)
    : 0
  const hasCredibilityAward =
    standing.credibility_before != null &&
    standing.credibility_after != null &&
    delta != null
  const estimatedDelta = Math.round((Math.max(0, summary.score - 500) / 100) * 100) / 100
  const before = standing.credibility_before
  const after = standing.credibility_after
  const beforeText = before != null ? before.toFixed(2) : ''
  const afterText = after != null ? after.toFixed(2) : ''
  return (
    <div className="mt-4 rounded-[1.5rem] border border-cyan-200/15 bg-cyan-300/10 p-4 text-left sm:mt-7 sm:rounded-[1.75rem] sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200/60">Your match summary</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
        <BattleStat label="Leaderboard points" value={String(Math.round(standing.score))} />
        <BattleStat label="Final rank" value={`#${standing.rank}`} />
        <BattleStat label="Correct calls" value={`${standing.correct_answers ?? 0}/${standing.total_answers ?? 0}`} />
        <BattleStat label="Accuracy" value={`${accuracy}%`} />
      </div>
      <div className="mt-4 rounded-[1.5rem] bg-white/92 p-4 text-slate-950 shadow-xl shadow-black/20 sm:mt-5 sm:rounded-[1.75rem] sm:p-5">
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-[#29449e]/60">Credibility grade</p>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-600 sm:text-sm sm:leading-6">
              Every match is graded out of 1000. Lower scores give +0, never a deduction.
            </p>
          </div>
          <p className="shrink-0 text-right text-3xl font-black text-[#29449e] sm:text-4xl">
            {summary.score}
            <span className="text-sm text-slate-400 sm:text-base">/1000</span>
          </p>
        </div>
        {hasCredibilityAward ? (
          <>
            <p className={`mt-4 rounded-2xl bg-white px-4 py-3 text-center text-sm font-black shadow-sm sm:mt-5 ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              Profile credibility gained +{Math.max(0, delta).toFixed(2)}
            </p>
            <p className="mt-3 text-center text-sm font-bold text-slate-500 sm:mt-4">
              Added to your main credibility: {beforeText} -&gt; {afterText}
            </p>
          </>
        ) : (
          <>
            <p className={`mt-4 rounded-2xl bg-white px-4 py-3 text-center text-sm font-black shadow-sm sm:mt-5 ${estimatedDelta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              Estimated profile credibility gained +{estimatedDelta.toFixed(2)}
            </p>
            <p className="mt-3 text-center text-sm font-bold text-slate-500 sm:mt-4">
              Waiting for the server to confirm your final profile update.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function BattleStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/92 px-3 py-4 text-center shadow-lg shadow-black/10 sm:rounded-[1.5rem] sm:px-4 sm:py-5">
      <p className="font-display text-2xl font-extrabold text-[#29449e] sm:text-3xl">{value}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 sm:text-[11px] sm:tracking-[0.22em]">{label}</p>
    </div>
  )
}

interface BattleCredibilitySummary {
  score: number
  breakdown: Record<string, number>
}

function mergeLocalBattleStats(
  standings: Standing[],
  userId: number | undefined,
  localStats: { total: number; correct: number; questionTotal?: number },
): Standing[] {
  if (userId == null) return standings
  return standings.map((standing) => {
    if (standing.user_id !== userId) return standing
    return {
      ...standing,
      total_answers: localStats.total > 0 ? localStats.total : standing.total_answers,
      correct_answers: localStats.total > 0 ? localStats.correct : standing.correct_answers,
      question_total: localStats.questionTotal,
    }
  })
}

function buildBattleCredibilitySummary(standing: Standing): BattleCredibilitySummary {
  if (standing.run_credibility_score != null && standing.run_credibility_breakdown) {
    return {
      score: standing.run_credibility_score,
      breakdown: standing.run_credibility_breakdown,
    }
  }

  const totalAnswers = Math.max(standing.total_answers ?? 0, 0)
  const questionTotal = Math.max(standing.question_total ?? 10, 1)
  if (totalAnswers === 0) {
    return {
      score: 0,
      breakdown: {
        'Correct calls': 0,
        'Top 3 bonus': 0,
        Speed: 0,
        'Hearts left': 0,
        Participation: 0,
      },
    }
  }

  const coverage = Math.max(0, Math.min(1, totalAnswers / questionTotal))
  const correctCalls = Math.round(Math.max(0, Math.min(1, (standing.correct_answers ?? 0) / questionTotal)) * 500)
  const topThreeBonus = standing.rank === 1 ? 250 : standing.rank === 2 ? 175 : standing.rank === 3 ? 100 : 0
  const heartsLeft = Math.round(Math.max(0, Math.min(1, standing.lives / 2)) * 50)
  const breakdown = {
    'Correct calls': correctCalls,
    'Top 3 bonus': topThreeBonus,
    Speed: 0,
    'Hearts left': heartsLeft,
    Participation: Math.round(coverage * 100),
  }

  return {
    score: Math.max(0, Math.min(1000, Object.values(breakdown).reduce((sum, value) => sum + value, 0))),
    breakdown,
  }
}

function VerdictButton({
  label,
  sublabel,
  tone,
  disabled,
  onClick,
}: {
  label: string
  sublabel: string
  tone: 'fake' | 'real'
  disabled: boolean
  onClick: () => void
}) {
  const styles =
    tone === 'fake'
      ? 'from-rose-500 to-orange-300 shadow-rose-950/30'
      : 'from-emerald-400 to-cyan-300 shadow-emerald-950/30'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[1.5rem] bg-gradient-to-br ${styles} p-5 text-left text-slate-950 shadow-2xl transition duration-300 hover:-translate-y-1 disabled:translate-y-0 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-45`}
    >
      <span className="block text-xs font-black uppercase tracking-[0.35em] opacity-70">{sublabel}</span>
      <span className="mt-2 block text-2xl font-black">{label}</span>
    </button>
  )
}

function HeartRow({ lives }: { lives: number }) {
  return (
    <div className="flex items-center gap-1" aria-label={`${lives} lives remaining`}>
      {[0, 1].map((i) => (
        <span
          key={i}
          className={`h-3 w-3 rounded-full ${i < lives ? 'bg-rose-300 shadow-[0_0_16px_rgba(253,164,175,0.8)]' : 'bg-white/15'}`}
        />
      ))}
    </div>
  )
}

function PanelTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.36em] text-cyan-200/60">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-black text-white">{title}</h2>
    </div>
  )
}

function StatusPill({ children, tone }: { children: ReactNode; tone: 'info' | 'success' | 'warning' | 'danger' }) {
  const styles = {
    info: 'border-cyan-200/20 bg-cyan-300/10 text-cyan-100',
    success: 'border-emerald-200/20 bg-emerald-300/10 text-emerald-100',
    warning: 'border-amber-200/20 bg-amber-300/10 text-amber-100',
    danger: 'border-rose-200/20 bg-rose-300/10 text-rose-100',
  }[tone]
  return <span className={`rounded-full border px-4 py-2 text-sm font-bold ${styles}`}>{children}</span>
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#070912] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.22),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(251,113,133,0.18),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.8),rgba(2,6,23,1))]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:52px_52px]" />
      {children}
    </div>
  )
}
