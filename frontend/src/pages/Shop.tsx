import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { GAME_LABEL, type Inventory, type PowerupItem, type PurchaseResult } from '../types/shop'

const API = '/api/game/shop'

/**
 * Power-Up Shop — spend credibility points on power-ups that carry into the
 * games. Reached from the Power-Up Shop building in Newisance Town (or /shop).
 * Purchases hit the game-service, which deducts credibility server-side and
 * tracks inventory; the result updates the cached profile + owned counts.
 */
export default function Shop() {
  const { user, token, patchUser } = useAuth()
  const [items, setItems] = useState<PowerupItem[]>([])
  const [inventory, setInventory] = useState<Inventory>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const credibility = user ? Math.floor(user.credibility_score) : 0

  const flash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg })
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
        const [itemsRes, invRes] = await Promise.all([
          fetch(`${API}/items`, { cache: 'no-store' }),
          token ? fetch(`${API}/inventory`, { headers, cache: 'no-store' }) : Promise.resolve(null),
        ])
        const loadedItems = (await itemsRes.json()) as PowerupItem[]
        const inv = invRes && invRes.ok ? ((await invRes.json()) as Inventory) : {}
        if (cancelled) return
        setItems(loadedItems)
        setInventory(inv)
      } catch {
        if (!cancelled) flash('err', 'Could not load the shop')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token, flash])

  const buy = useCallback(
    async (item: PowerupItem) => {
      if (!token) {
        flash('err', 'Log in to buy power-ups')
        return
      }
      setBusy(item.key)
      try {
        const res = await fetch(`${API}/purchase`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: item.key }),
        })
        if (res.status === 402) {
          flash('err', 'Not enough credibility for that one')
          return
        }
        if (!res.ok) {
          const raw = await res.text()
          let message = raw
          try {
            const parsed = JSON.parse(raw) as { detail?: string }
            message = parsed.detail ?? raw
          } catch {
            // Keep non-JSON backend/proxy errors as-is.
          }
          flash('err', message || `Purchase failed (${res.status})`)
          return
        }
        const result = (await res.json()) as PurchaseResult
        setInventory((prev) => ({ ...prev, [item.key]: result.quantity }))
        patchUser({ credibility_score: result.credibility_score, tier: result.tier })
        flash('ok', `Bought ${item.name}! You own ${result.quantity}.`)
      } catch {
        flash('err', 'Purchase failed — try again')
      } finally {
        setBusy(null)
      }
    },
    [token, patchUser, flash],
  )

  return (
    <div className="mx-auto w-full max-w-6xl overflow-x-hidden px-3 py-5 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-extrabold leading-tight text-card sm:text-5xl">
            ⚡ Power-Up Shop
          </h1>
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-ink-soft sm:mt-3 sm:text-lg sm:leading-7">
            Spend your hard-earned credibility on power-ups that give you an edge in the games.
          </p>
        </div>
        <div className="rounded-xl bg-card px-3 py-2 text-center text-white shadow-lg shadow-card/20 sm:rounded-3xl sm:px-6 sm:py-4">
          <p className="text-[10px] uppercase tracking-wide text-white/50 sm:text-xs">Your credibility</p>
          <p className="font-display text-xl font-extrabold text-secondary sm:text-3xl">{credibility}</p>
        </div>
      </header>

      {!token && (
        <div className="mt-4 rounded-xl border border-highlight/40 bg-highlight/10 px-3 py-2.5 text-xs font-medium leading-5 text-ink sm:mt-6 sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm">
          You're browsing as a guest.{' '}
          <Link to="/login" className="font-bold text-brand hover:underline">
            Log in
          </Link>{' '}
          to buy and keep power-ups.
        </div>
      )}

      {loading ? (
        <p className="mt-12 text-center text-ink-soft">Loading the shelves…</p>
      ) : (
        <div className="mt-5 grid min-w-0 gap-2.5 sm:mt-10 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {items.map((item) => {
            const owned = inventory[item.key] ?? 0
            const affordable = credibility >= item.cost
            return (
              <article
                key={item.key}
                className="flex min-w-0 flex-col rounded-xl border border-black/5 bg-surface p-2.5 text-ink shadow-sm transition hover:-translate-y-1 hover:shadow-xl sm:rounded-3xl sm:p-6"
              >
                <div className="flex items-start justify-between">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg text-xl sm:h-16 sm:w-16 sm:rounded-2xl sm:text-4xl">
                    {item.emoji}
                  </span>
                  {owned > 0 && (
                    <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-bold text-secondary sm:px-3 sm:py-1 sm:text-xs">
                      Owned ×{owned}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 font-display text-base font-extrabold leading-snug text-card sm:mt-4 sm:text-2xl">{item.name}</h2>
                <span className="mt-1 w-fit rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand sm:px-2.5 sm:text-[11px]">
                  {GAME_LABEL[item.game]}
                </span>
                <p className="mt-1.5 flex-1 text-[11px] leading-4 text-ink sm:mt-3 sm:text-sm sm:leading-5">{item.description}</p>
                <div className="mt-3 flex items-center justify-between gap-2 sm:mt-6 sm:gap-3">
                  <span className="shrink-0 font-display text-base font-extrabold text-card sm:text-xl">
                    {item.cost}
                    <span className="ml-1 text-[10px] font-semibold text-ink sm:text-xs">cred</span>
                  </span>
                  <button
                    onClick={() => void buy(item)}
                    disabled={busy === item.key || (!!token && !affordable)}
                    className="min-w-0 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-bold text-white shadow-md shadow-brand/25 transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40 sm:rounded-xl sm:px-5 sm:py-2.5 sm:text-sm"
                  >
                    {busy === item.key ? 'Buying…' : !token ? 'Log in to buy' : affordable ? 'Buy' : 'Too pricey'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <p className="mt-7 px-2 text-center text-xs leading-5 text-ink-soft sm:mt-10 sm:text-sm">
        Power-ups are activated from the games' power-up panel.{' '}
        <Link to="/timed-challenge" className="font-semibold text-brand hover:underline">
          Play Flappy →
        </Link>
      </p>

      {toast && (
        <div
          className={`nz-pop fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl px-4 py-2.5 text-center text-xs font-bold text-white shadow-2xl sm:bottom-6 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm ${
            toast.kind === 'ok' ? 'bg-risk-low' : 'bg-risk-critical'
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
