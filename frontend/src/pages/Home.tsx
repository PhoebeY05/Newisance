import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import TierBadge from '../components/TierBadge'
import { useApi } from '../hooks/useApi'
import type { LeaderboardEntry, ScamTypes } from '../types/dashboard'

// 3D town preview pulls in three.js — lazy-load so it doesn't weigh down the
// landing page's initial bundle (it streams in after first paint).
const TownPreview = lazy(() => import('../components/TownPreview'))

/**
 * Home screen — static frontend shell based on the Figma design
 * (frame "Home Page", node 7:38), styled to the Figma color scheme:
 * deep-blue brand, teal secondary, yellow highlight, navy cards,
 * green→red risk levels, on a light-gray background. No real features yet.
 */
export default function Home() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Hero />
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <TopDefenders />
        <TopScams />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Hero */

function Hero() {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-2">
      <div>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-secondary/15 text-secondary">
            <ShieldIcon />
          </span>
          <span className="text-base font-semibold text-ink-soft">
            Spot the fake, Stop the spread!
          </span>
        </div>

        <h1 className="mt-6 max-w-xl font-display text-4xl font-extrabold leading-tight text-card sm:text-5xl">
          Stop Online <span className="text-brand">Newisance</span> Before It Spreads
        </h1>

        <p className="mt-5 max-w-lg text-lg text-ink-soft">
          Learn to identify misinformation, verify suspicious content, and start earning rewards!
        </p>

        <Link
          to="/learn"
          data-tour="start-playing"
          className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-brand px-7 py-4 text-lg font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/25">
            <PlayIcon />
          </span>
          Start Playing Now!
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="grid h-[420px] place-items-center rounded-3xl bg-card text-white/70 shadow-xl shadow-card/20">
            Loading Newisance Town…
          </div>
        }
      >
        <TownPreview />
      </Suspense>
    </section>
  )
}

/* -------------------------------------------------------- Top defenders */

const medal: Record<number, string> = {
  1: 'bg-highlight text-ink',
  2: 'bg-ink-faint text-white',
  3: 'bg-risk-med text-white',
}

function TopDefenders() {
  const apiFetch = useApi()
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const res = await apiFetch('/api/dashboard/leaderboard?scope=weekly&limit=5&refresh=true')
        if (!res.ok) throw new Error('Could not load leaderboard')
        const data = (await res.json()) as LeaderboardEntry[]
        if (active) setEntries(data)
      } catch {
        if (active) setEntries([])
      }
    }

    void load()
    const interval = window.setInterval(() => {
      void load()
    }, 30000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [apiFetch])

  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-extrabold text-card">Top Newisance Defenders!</h2>
        <Link to="/leaderboard" className="text-sm font-semibold text-brand hover:underline">
          View more...
        </Link>
      </div>

      {entries === null ? (
        <p className="mt-5 text-sm text-ink-soft">Loading defenders...</p>
      ) : entries.length === 0 ? (
        <p className="mt-5 rounded-xl bg-bg px-4 py-3 text-sm text-ink-soft">
          No defenders on the weekly board yet. Play a round to claim a spot.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {entries.map((entry) => (
            <li key={entry.user_id} className="flex items-center gap-4 rounded-xl bg-bg px-4 py-3">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
                  medal[entry.rank] ?? 'bg-brand text-white'
                }`}
              >
                {entry.rank}
              </span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary/15 text-sm font-bold text-secondary">
                {initials(entry.username)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-card">{entry.username}</span>
                <TierBadge tier={entry.tier} className="mt-1" />
              </span>
              <span className="shrink-0 font-bold text-brand">{Math.round(entry.score).toLocaleString()} pts</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function initials(name: string): string {
  const parts = name.replace(/[_-]/g, ' ').trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/* ------------------------------------------------------------ Top scams */

interface ScamStat {
  label: string
  value: number
  count: number
}

function TopScams() {
  const apiFetch = useApi()
  const [items, setItems] = useState<ScamStat[] | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const res = await apiFetch('/api/dashboard/scam-types?refresh=true')
        if (!res.ok) throw new Error('Could not load scam types')
        const data = (await res.json()) as ScamTypes
        const source =
          data.by_category.length > 0
            ? data.by_category.map((item) => ({ label: item.category, count: item.count }))
            : data.by_content_type.map((item) => ({ label: typeLabel(item.content_type), count: item.count }))
        const total = Math.max(1, source.reduce((sum, item) => sum + item.count, 0))
        const next = source
          .slice(0, 5)
          .map((item) => ({ ...item, value: Math.round((item.count / total) * 100) }))
        if (active) setItems(next)
      } catch {
        if (active) setItems([])
      }
    }

    void load()
    const interval = window.setInterval(() => {
      void load()
    }, 30000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [apiFetch])

  return (
    <section className="rounded-3xl border border-black/5 bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-extrabold text-card">
          Top Newisances Of All Time
        </h2>
        <Link to="/dashboard" className="text-sm font-semibold text-brand hover:underline">
          View more…
        </Link>
      </div>
      {items === null ? (
        <p className="mt-6 text-sm text-ink-soft">Loading top categories...</p>
      ) : items.length === 0 ? (
        <p className="mt-6 rounded-xl bg-bg px-4 py-3 text-sm text-ink-soft">
          No submissions yet. Topics appear once community content is submitted.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {items.map((s) => (
            <div key={s.label}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium text-card">{s.label}</span>
                <span className="shrink-0 font-bold text-ink-soft">
                  {s.count} · {s.value}%
                </span>
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-secondary to-brand-light"
                  style={{ width: `${Math.max(s.value, 4)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function typeLabel(contentType: string): string {
  if (contentType === 'url') return 'Links'
  if (contentType === 'image') return 'Images'
  if (contentType === 'text') return 'Text'
  return contentType
}

/* --------------------------------------------------------------- Icons */

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m8.5 12 2.3 2.3L15.5 9.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  )
}

