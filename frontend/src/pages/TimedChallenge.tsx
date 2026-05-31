import { useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Timed Challenge — full-screen Flappy-Bird-style game (Figma nodes 81:914
 * Question / 81:1088 Answer / 123:2 Game Over). Top HUD, stats + power-up
 * sidebars, a game canvas with Real/Fake pipes and the newspaper character,
 * an "IDENTIFY THIS" popup, and a Game Over overlay (toggleable).
 * Presentational only — no real game loop.
 */
export default function TimedChallenge() {
  const [showPopup, setShowPopup] = useState(true)
  const [gameOver, setGameOver] = useState(false)

  return (
    <div className="relative flex min-h-screen flex-col bg-card text-white">
      {/* Top HUD */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📰</span>
          <span className="font-display text-xl font-extrabold">Timed Challenge</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Hud label="Score" value="2,450" />
          <Hud label="Level" value="7" />
          <Hud label="Streak" value="12" />
          <Hud label="Time" value="2:34" />
        </div>
      </header>

      <div className="grid flex-1 gap-6 p-6 lg:grid-cols-[14rem_1fr_16rem]">
        {/* Left — stats */}
        <aside className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
          <h3 className="font-display text-lg font-extrabold">📊 Stats</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {stats.map((s) => (
              <li key={s.label} className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-white/60">{s.label}</span>
                <span className="font-bold">{s.value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-2xl bg-white/5 p-3 text-center ring-1 ring-white/10">
            <p className="text-xs text-white/50">Current Speed</p>
            <p className="font-display text-xl font-extrabold text-secondary">×1.7</p>
          </div>
        </aside>

        {/* Center — game canvas */}
        <section className="relative grid place-items-center overflow-hidden rounded-3xl bg-gradient-to-b from-sky-300 to-sky-100">
          {/* Pipes (Real/Fake) */}
          <div className="absolute inset-0 flex items-center justify-around px-10">
            {pipeSets.map((p, i) => (
              <div key={i} className="flex h-full flex-col justify-between py-6">
                <div className="grid w-20 place-items-center rounded-xl bg-risk-low/80 py-4 font-extrabold text-white">
                  {p.top}
                </div>
                <div className="grid w-20 place-items-center rounded-xl bg-risk-critical/80 py-4 font-extrabold text-white">
                  {p.bottom}
                </div>
              </div>
            ))}
          </div>

          {/* Newspaper character */}
          <span className="relative z-10 text-5xl drop-shadow-lg">📰</span>

          {/* Ground */}
          <div className="absolute bottom-0 h-8 w-full bg-amber-700/80" />

          {/* Controls */}
          <div className="absolute bottom-12 left-1/2 z-10 flex -translate-x-1/2 gap-3">
            {controls.map((c) => (
              <span
                key={c.key}
                className="rounded-xl bg-card/80 px-3 py-2 text-center text-xs font-semibold"
              >
                <span className="block font-extrabold text-secondary">{c.key}</span>
                {c.label}
              </span>
            ))}
          </div>

          {/* Identify-this popup */}
          {showPopup && (
            <div className="absolute right-4 top-4 z-20 w-72 rounded-2xl bg-card p-4 text-white shadow-2xl ring-1 ring-white/10">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-sm font-extrabold text-risk-med">⚠️ IDENTIFY THIS</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">⏱️ 5s</span>
              </div>
              <div className="mt-3 grid place-items-center rounded-xl bg-white/5 py-6 text-center">
                <span className="text-3xl">📸</span>
                <p className="mt-2 px-3 text-sm font-semibold">
                  Viral Photo: "Miracle cure discovered!"
                </p>
                <p className="mt-1 text-[11px] text-white/40">
                  [Fake manipulated image would display here]
                </p>
              </div>
              <div className="mt-3 border-l-2 border-risk-med/50 pl-3">
                <p className="text-[11px] uppercase tracking-wide text-white/40">Claim</p>
                <p className="text-sm text-white/80">
                  "New medical breakthrough cures all diseases instantly - doctors don't want you
                  to know!"
                </p>
              </div>
              <p className="mt-3 text-xs text-white/50">🌐 Source: UnverifiedHealthNews.com</p>
              <p className="mt-3 rounded-xl bg-white/5 p-2 text-center text-xs">
                💭 Remember this! Is it REAL or FAKE?
              </p>
              <button
                onClick={() => setShowPopup(false)}
                className="mt-3 w-full rounded-xl bg-brand py-2 text-sm font-bold"
              >
                Got it
              </button>
            </div>
          )}
        </section>

        {/* Right — power-ups */}
        <aside className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
          <h3 className="font-display text-lg font-extrabold">⚡ Power-Ups</h3>
          <ul className="mt-4 space-y-3">
            {powerups.map((p) => (
              <li key={p.title} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{p.emoji}</span>
                  <span className="text-sm font-semibold">{p.title}</span>
                </div>
                <p
                  className={`mt-1 text-xs ${
                    p.active ? 'font-bold text-risk-low' : 'text-white/50'
                  }`}
                >
                  {p.status}
                </p>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setGameOver(true)}
            className="mt-4 w-full rounded-xl bg-risk-critical/20 py-2 text-sm font-bold text-risk-critical"
          >
            Simulate Game Over
          </button>
        </aside>
      </div>

      {gameOver && <GameOver onClose={() => setGameOver(false)} />}
    </div>
  )
}

function GameOver({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-card/95 p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-surface p-8 text-card shadow-2xl">
        <p className="text-center font-display text-sm font-extrabold uppercase tracking-widest text-risk-critical">
          You flew the wrong way!
        </p>
        <h2 className="mt-2 text-center font-display text-4xl font-extrabold text-card">Game Over</h2>
        <p className="mt-2 text-center text-ink-soft">That content was fake — you chose Real</p>

        <div className="mt-6 rounded-2xl bg-bg p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Content you judged
          </p>
          <p className="mt-1 font-semibold text-card">Viral photo: "Miracle cure discovered!"</p>
          <p className="mt-1 text-sm text-ink-soft">
            "New medical breakthrough cures all diseases instantly — doctors don't want…"
          </p>
          <p className="mt-2 text-sm font-bold text-risk-critical">
            Your answer: Real · Correct: Fake
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Why it's fake</p>
          <p className="mt-1 text-sm text-ink-soft">
            This image shows signs of AI generation and the claim was not found on any credible
            news source. Phrases like "doctors don't want you to know" are common emotional
            manipulation tactics.
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Warning signs you missed
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {['Unverified source', 'Emotional language', 'AI-generated image', 'Exaggerated claim'].map(
              (w) => (
                <span
                  key={w}
                  className="rounded-full bg-risk-critical/10 px-3 py-1 text-xs font-semibold text-risk-critical"
                >
                  {w}
                </span>
              ),
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {[
            { v: '2,450', l: 'Score' },
            { v: '12', l: 'Streak' },
            { v: '76%', l: 'Accuracy' },
            { v: '7', l: 'Level' },
            { v: '18', l: 'Best streak' },
          ].map((s) => (
            <div key={s.l} className="rounded-2xl bg-bg p-3 text-center">
              <p className="font-display text-lg font-extrabold text-card">{s.v}</p>
              <p className="text-xs text-ink-soft">{s.l}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-brand py-3 text-sm font-bold text-white transition hover:bg-brand-light"
          >
            Play again
          </button>
          <Link
            to="/leaderboard"
            className="flex-1 rounded-xl border border-black/10 py-3 text-center text-sm font-bold text-ink-soft transition hover:bg-bg"
          >
            View leaderboard
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-ink-faint">
          Newisance · Digital Shield · CODE_EXP 2026 · BRAINHACK 2026
        </p>
      </div>
    </div>
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

const stats = [
  { label: 'Pipes Cleared', value: '47' },
  { label: 'Accuracy', value: '92%' },
  { label: 'Best Streak', value: '18' },
  { label: 'Speed', value: 'Fast' },
]

const pipeSets = [
  { top: 'Real', bottom: 'Fake' },
  { top: 'Fake', bottom: 'Real' },
  { top: 'Real', bottom: 'Fake' },
]

const controls = [
  { key: 'SPACE', label: 'Tap to Fly' },
  { key: '↑', label: 'Use Power-Up' },
  { key: 'ESC', label: 'Pause' },
]

const powerups = [
  { emoji: '🛡️', title: 'Shield', status: 'ACTIVE - 3s left', active: true },
  { emoji: '👁️', title: 'Highlight Key Words', status: 'Next: 150 pts', active: false },
  { emoji: '⏰', title: 'Slow Motion', status: 'Next: 300 pts', active: false },
  { emoji: '⭐', title: 'Double Points', status: 'Next: 500 pts', active: false },
]
