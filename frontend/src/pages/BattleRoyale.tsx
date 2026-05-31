import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Battle Royale — full-screen game screen (Figma node 78:736). Top bar with
 * timer/alive count, a players leaderboard on the left, the current question
 * in the center, and a live feed + your-stats panel on the right.
 * Presentational only — no real game logic.
 */
export default function BattleRoyale() {
  return (
    <div className="flex min-h-screen flex-col bg-card text-white">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚔️</span>
          <span className="font-display text-xl font-extrabold tracking-wide">BATTLE ROYALE</span>
        </div>
        <div className="flex items-center gap-3">
          <Pill>⏱️ 0:45</Pill>
          <Pill>👥 3 / 10 Alive</Pill>
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
            {players.map((p) => (
              <li
                key={p.rank}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${
                  p.you ? 'bg-brand/30 ring-1 ring-brand' : 'bg-white/5'
                }`}
              >
                <span className="w-5 text-sm font-bold text-white/50">{p.rank}</span>
                <span className="text-lg">{p.emoji}</span>
                <span className="flex-1 text-sm font-semibold">{p.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    p.status === 'ALIVE' ? 'bg-risk-low/20 text-risk-low' : 'bg-white/10 text-white/40'
                  }`}
                >
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        {/* Center — question */}
        <section className="flex flex-col items-center justify-center">
          <Pill>Round 5 of 10</Pill>
          <div className="mt-6 w-full max-w-xl rounded-3xl bg-white p-8 text-center text-card shadow-xl">
            <p className="text-sm font-semibold text-ink-soft">Viral Social Media News</p>
            <p className="mt-4 text-xl font-bold">
              "Government announces free $1,000 for every citizen — claim before midnight!"
            </p>
          </div>
          <div className="mt-6 grid w-full max-w-xl grid-cols-2 gap-4">
            <button className="rounded-2xl bg-risk-critical py-5 text-lg font-extrabold text-white transition hover:opacity-90">
              FAKE
            </button>
            <button className="rounded-2xl bg-risk-low py-5 text-lg font-extrabold text-white transition hover:opacity-90">
              REAL
            </button>
          </div>
          <p className="mt-4 text-sm text-white/60">15 seconds remaining</p>
        </section>

        {/* Right — live feed + stats */}
        <aside className="flex flex-col gap-4">
          <div className="flex-1 rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
            <h3 className="font-display text-lg font-extrabold">📡 Live Feed</h3>
            <ul className="mt-4 space-y-3">
              {feed.map((f, i) => (
                <li key={i} className="border-l-2 border-secondary/40 pl-3">
                  <p className="text-[11px] text-white/40">{f.time}</p>
                  <p className="text-sm text-white/80">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
            {yourStats.map((s) => (
              <div key={s.label}>
                <p className="font-display text-xl font-extrabold text-secondary">{s.value}</p>
                <p className="text-xs text-white/50">{s.label}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/10">
      {children}
    </span>
  )
}

interface Player {
  rank: number
  emoji: string
  name: string
  status: 'ALIVE' | 'OUT'
  you?: boolean
}

const players: Player[] = [
  { rank: 1, emoji: '🦊', name: 'You', status: 'ALIVE', you: true },
  { rank: 2, emoji: '🐝', name: 'FactMaster', status: 'ALIVE' },
  { rank: 3, emoji: '🥷', name: 'TruthSeeker', status: 'ALIVE' },
  { rank: 4, emoji: '🔍', name: 'CyberSleuth', status: 'ALIVE' },
  { rank: 5, emoji: '🛡️', name: 'InfoGuard', status: 'ALIVE' },
  { rank: 6, emoji: '👻', name: 'NewsHound', status: 'OUT' },
  { rank: 7, emoji: '🎯', name: 'Verifier99', status: 'OUT' },
  { rank: 8, emoji: '⚡', name: 'QuickCheck', status: 'OUT' },
]

const feed = [
  { time: 'Just now', text: 'QuickCheck eliminated! Wrong answer on Question 4' },
  { time: '5s ago', text: 'TruthSeeker answered correctly! (+50 pts)' },
  { time: '12s ago', text: 'Verifier99 eliminated! Wrong answer on Question 4' },
  { time: '18s ago', text: '⚠️ 5 players eliminated in the last round!' },
  { time: '25s ago', text: 'FactMaster answered correctly! (+50 pts)' },
  { time: '30s ago', text: 'NewsHound eliminated! Time ran out' },
]

const yourStats = [
  { value: '76%', label: 'Your Accuracy' },
  { value: '450', label: 'Your Score' },
  { value: '4/5', label: 'Correct' },
  { value: '12s', label: 'Avg Time' },
]
