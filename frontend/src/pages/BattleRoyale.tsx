import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Battle Royale — real-time multiplayer (Phase 4), wired to the game-service
 * WebSocket server. On mount it POSTs /api/game/battle/join to get a room, then
 * opens a WS to /api/game/battle/ws/{room_id}?token=<jwt> and renders the live
 * stream of events: room_state, feed_event, new_question, answer_result,
 * player_eliminated, game_over. A wrong answer (or timeout) eliminates you
 * into spectate mode.
 */

const TYPE_LABELS: Record<string, string> = {
  misleading_headline: 'Misleading headline',
  deepfake: 'Deepfake suspicion',
  manipulated_media: 'Manipulated image',
  scam_message: 'Scam message',
  satire: 'Satire',
}

type FeedTone = 'info' | 'success' | 'warning' | 'danger'

const FEED_KIND_ICON: Record<string, string> = {
  player_joined: '👤',
  spectator_joined: '👁️',
  player_left: '🚪',
  match_started: '⚔️',
  round_started: '🔔',
  new_question: '❓',
  answer_correct: '✅',
  answer_result: '📣',
  player_eliminated: '💀',
  round_ended: '⏱️',
  game_over: '🏁',
}

const FEED_TONE_STYLES: Record<FeedTone, string> = {
  info: 'border-secondary/40 bg-secondary/10 text-white/85',
  success: 'border-risk-low/40 bg-risk-low/10 text-white/85',
  warning: 'border-risk-med/40 bg-risk-med/10 text-white/85',
  danger: 'border-risk-high/40 bg-risk-high/10 text-white/85',
}

interface PlayerRow {
  user_id: number
  username: string
  score: number
  alive: boolean
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
}

interface Standing {
  rank: number
  user_id: number
  username: string
  score: number
  alive: boolean
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
  if (diffSeconds < 5) return 'Just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const minutes = Math.floor(diffSeconds / 60)
  return `${minutes}m ago`
}

export default function BattleRoyale() {
  const { user, token, loginAsGuest } = useAuth()

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

  const wsRef = useRef<WebSocket | null>(null)
  const feedId = useRef(0)
  const feedScrollRef = useRef<HTMLUListElement | null>(null)

  const appendFeed = useCallback((item: Omit<FeedItem, 'id'>) => {
    feedId.current += 1
    const id = feedId.current
    setFeed((prev) => [{ id, ...item }, ...prev].slice(0, 24))
  }, [])

  useEffect(() => {
    feedScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [feed])

  useEffect(() => {
    if (!token) return
    let closed = false

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
          // Ignore any socket that isn't the current one (StrictMode / reconnect
          // can briefly leave a stale socket alive; its messages would otherwise
          // mix state from a different room).
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
                kind: 'answer_correct',
                tone: 'success',
                text: `${msg.username} answered correctly and earned +${Math.round(msg.points_earned)} pts`,
                createdAt: Date.now(),
              })
              break
            case 'new_question':
              // A question implies the match is live — flip status defensively so
              // the question always renders even if a room_state lags or is missed.
              appendFeed({
                kind: 'new_question',
                tone: 'info',
                text: `Question ${msg.index + 1} of ${msg.total} is now live`,
                createdAt: Date.now(),
              })
              setStatus('active')
              setQuestion({ ...msg.question, index: msg.index, total: msg.total })
              setDurationMs(msg.duration_ms)
              setQuestionDeadline(Date.now() + msg.duration_ms)
              setAnswered(false)
              setResult(null)
              break
            case 'answer_result':
              setResult(msg)
              break
            case 'player_eliminated':
              appendFeed({
                kind: 'player_eliminated',
                tone: msg.reason === 'timeout' ? 'warning' : 'danger',
                text: `${msg.username} eliminated — ${
                  msg.reason === 'timeout' ? 'ran out of time' : 'wrong answer'
                }`,
                createdAt: Date.now(),
              })
              break
            case 'game_over':
              setStandings(msg.standings)
              setStatus('finished')
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

  // Tick the auto-start countdown down to zero while waiting.
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
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [status, questionDeadline])

  const me = user ? players.find((p) => p.user_id === user.id) : undefined
  const eliminated = me ? !me.alive : false
  const aliveCount = players.filter((p) => p.alive).length
  const questionSecondsLeft = Math.max(0, Math.ceil(((questionTimeLeftMs ?? durationMs) / 1000) || 0))

  const submit = (answer: 'Real' | 'Fake') => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !question || answered || eliminated) return
    ws.send(JSON.stringify({ type: 'submit_answer', question_id: question.id, answer }))
    setAnswered(true)
  }

  // ---- auth gate -------------------------------------------------------
  if (!token) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm">
            <p className="font-display text-3xl font-extrabold">⚔️ Battle Royale</p>
            <p className="mt-3 text-white/70">Sign in to enter a live multiplayer match.</p>
            <button
              onClick={() => void loginAsGuest()}
              className="mt-6 w-full rounded-xl bg-brand py-3 font-bold hover:bg-brand-light"
            >
              Play as guest
            </button>
            <Link to="/login" className="mt-3 block text-sm text-secondary hover:underline">
              Log in instead
            </Link>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚔️</span>
          <span className="font-display text-xl font-extrabold tracking-wide">BATTLE ROYALE</span>
        </div>
        <div className="flex items-center gap-3">
          <Pill>{connected ? '🟢 Connected' : '🔌 Connecting…'}</Pill>
          <Pill>👥 {aliveCount} alive</Pill>
          <Link
            to="/learn"
            className="rounded-full bg-risk-critical/20 px-4 py-1.5 text-sm font-bold text-risk-critical transition hover:bg-risk-critical/30"
          >
            Quit
          </Link>
        </div>
      </header>

      <div className="grid flex-1 gap-6 p-6 lg:grid-cols-[16rem_1fr_18rem]">
        {/* Left — players */}
        <aside className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
          <h3 className="font-display text-lg font-extrabold">🏆 Leaderboard</h3>
          <ul className="mt-4 space-y-2">
            {players.map((p, i) => (
              <li
                key={p.user_id}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${
                  user && p.user_id === user.id ? 'bg-brand/30 ring-1 ring-brand' : 'bg-white/5'
                }`}
              >
                <span className="w-5 text-sm font-bold text-white/50">{i + 1}</span>
                <span className="flex-1 truncate text-sm font-semibold">
                  {p.username}
                  {user && p.user_id === user.id ? ' (you)' : ''}
                </span>
                <span className="text-xs font-bold text-secondary">{Math.round(p.score)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    p.alive ? 'bg-risk-low/20 text-risk-low' : 'bg-white/10 text-white/40'
                  }`}
                >
                  {p.alive ? 'ALIVE' : 'OUT'}
                </span>
              </li>
            ))}
            {players.length === 0 && <li className="text-sm text-white/50">No players yet…</li>}
          </ul>
        </aside>

        {/* Center — question / states */}
        <section className="flex flex-col items-center justify-center">
          {error && <p className="mb-4 font-bold text-risk-high">{error}</p>}

          {status === 'waiting' && (
            <div className="text-center">
              <Pill>Waiting room</Pill>
              <p className="mt-6 font-display text-2xl font-extrabold">Waiting for players…</p>
              <p className="mt-2 text-white/60">
                {players.length} joined · auto-starts after 2 players (5+ starts instantly)
              </p>

              {secondsLeft != null ? (
                <div className="mt-8">
                  <p className="font-display text-7xl font-extrabold tabular-nums text-secondary">
                    {secondsLeft}
                  </p>
                  <p className="mt-2 text-white/60">Match starts automatically once 2 players are ready…</p>
                </div>
              ) : (
                <p className="mt-8 text-sm text-white/40">Need at least 2 players to start.</p>
              )}
            </div>
          )}

          {status === 'active' && question && (
            <>
              <Pill>
                Round {question.index + 1} of {question.total}
              </Pill>

              <div className="mt-3 flex items-center gap-2">
                <Pill>⏱️ {questionSecondsLeft}s left</Pill>
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
                  Question timer
                </span>
              </div>

              {/* Timer bar */}
              <div className="mt-4 w-full max-w-xl">
                <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                  <span>Time left</span>
                  <span>{questionSecondsLeft}s</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-secondary transition-[width] duration-200 ease-linear"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, (((questionTimeLeftMs ?? durationMs) / durationMs) || 0) * 100),
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="mt-6 w-full max-w-xl rounded-3xl bg-white p-8 text-center text-card shadow-xl">
                <p className="text-sm font-semibold text-ink-soft">
                  {TYPE_LABELS[question.type] ?? 'Content'}
                </p>
                {question.media_url && (
                  <img
                    src={question.media_url}
                    alt="Content under review"
                    className="mx-auto mt-3 max-h-48 rounded-xl object-cover"
                  />
                )}
                <p className="mt-4 text-xl font-bold">{question.content}</p>
              </div>

              {eliminated ? (
                <div className="mt-6 rounded-2xl bg-white/5 px-6 py-4 text-center ring-1 ring-white/10">
                  <p className="font-bold text-risk-high">💀 You're out — spectating</p>
                  <p className="mt-1 text-sm text-white/60">Watch who survives to the end!</p>
                </div>
              ) : (
                <div className="mt-6 grid w-full max-w-xl grid-cols-2 gap-4">
                  <button
                    onClick={() => submit('Fake')}
                    disabled={answered}
                    className="rounded-2xl bg-risk-critical py-5 text-lg font-extrabold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    FAKE
                  </button>
                  <button
                    onClick={() => submit('Real')}
                    disabled={answered}
                    className="rounded-2xl bg-risk-low py-5 text-lg font-extrabold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    REAL
                  </button>
                </div>
              )}

              {result && (
                <p
                  className={`mt-4 text-sm font-bold ${
                    result.is_correct ? 'text-risk-low' : 'text-risk-high'
                  }`}
                >
                  {result.is_correct
                    ? `✅ Correct! +${result.points_earned} pts`
                    : `❌ Wrong — eliminated (answer: ${result.correct_answer})`}
                </p>
              )}
              {answered && !result && (
                <p className="mt-4 text-sm text-white/50">Answer submitted — waiting…</p>
              )}
            </>
          )}

          {status === 'finished' && standings && (
            <Podium standings={standings} meId={user?.id} />
          )}
          </section>

        {/* Right — live feed */}
        <aside className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
          <h3 className="font-display text-lg font-extrabold">📡 Live Feed</h3>
          <ul ref={feedScrollRef} className="mt-4 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            {feed.map((f) => (
              <li
                key={f.id}
                className={`nz-pop rounded-2xl border-l-2 px-3 py-2 text-sm ${
                  FEED_TONE_STYLES[f.tone] ?? FEED_TONE_STYLES.info
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none">{FEED_KIND_ICON[f.kind] ?? '•'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-[0.24em] text-white/40">{f.kind.replaceAll('_', ' ')}</p>
                    <p className="mt-1 leading-relaxed text-white/85">{f.text}</p>
                    <p className="mt-2 text-xs text-white/40">{formatFeedTime(f.createdAt)}</p>
                  </div>
                </div>
              </li>
            ))}
            {feed.length === 0 && <li className="text-sm text-white/40">Events will appear here…</li>}
          </ul>
        </aside>
      </div>
    </Shell>
  )
}

function Podium({ standings, meId }: { standings: Standing[]; meId?: number }) {
  return (
    <div className="w-full max-w-md text-center">
      <h2 className="font-display text-4xl font-extrabold">🏁 Game over</h2>
      <ul className="mt-6 space-y-2 text-left">
        {standings.slice(0, 8).map((s) => (
          <li
            key={s.user_id}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${
              s.user_id === meId ? 'bg-brand/30 ring-1 ring-brand' : 'bg-white/5'
            }`}
          >
            <span className="w-6 font-display text-lg font-extrabold text-highlight">
              {s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank}
            </span>
            <span className="flex-1 truncate font-semibold">
              {s.username}
              {s.user_id === meId ? ' (you)' : ''}
            </span>
            <span className="text-sm font-bold text-secondary">{Math.round(s.score)}</span>
          </li>
        ))}
      </ul>
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
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-card text-white">{children}</div>
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/10">
      {children}
    </span>
  )
}
