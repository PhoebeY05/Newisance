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
    <div className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-card sm:text-5xl">
            ⚡ Power-Up Shop
          </h1>
          <p className="mt-2 max-w-xl text-sm text-ink-soft sm:mt-3 sm:text-lg">
            Spend your hard-earned credibility on power-ups that give you an edge in the games.
          </p>
        </div>
        <div className="rounded-2xl bg-card px-4 py-3 text-center text-white shadow-lg shadow-card/20 sm:rounded-3xl sm:px-6 sm:py-4">
          <p className="text-xs uppercase tracking-wide text-white/50">Your credibility</p>
          <p className="font-display text-2xl font-extrabold text-secondary sm:text-3xl">{credibility}</p>
        </div>
      </header>

      {!token && (
        <div className="mt-6 rounded-2xl border border-highlight/40 bg-highlight/10 px-5 py-3 text-sm font-medium text-ink">
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
        <div className="mt-6 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {items.map((item) => {
            const owned = inventory[item.key] ?? 0
            const affordable = credibility >= item.cost
            return (
              <article
                key={item.key}
                className="flex flex-col rounded-2xl border border-black/5 bg-surface p-3 text-ink shadow-sm transition hover:-translate-y-1 hover:shadow-xl sm:rounded-3xl sm:p-6"
              >
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-bg text-2xl sm:h-16 sm:w-16 sm:rounded-2xl sm:text-4xl">
                    {item.emoji}
                  </span>
                  {owned > 0 && (
                    <span className="rounded-full bg-secondary/15 px-2.5 py-1 text-[11px] font-bold text-secondary sm:px-3 sm:text-xs">
                      Owned ×{owned}
                    </span>
                  )}
                </div>
                <h2 className="mt-3 font-display text-lg font-extrabold text-card sm:mt-4 sm:text-2xl">{item.name}</h2>
                <span className="mt-1 w-fit rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand">
                  {GAME_LABEL[item.game]}
                </span>
                <p className="mt-2 flex-1 text-xs leading-5 text-ink sm:mt-3 sm:text-sm">{item.description}</p>
                <div className="mt-4 flex items-center justify-between gap-3 sm:mt-6">
                  <span className="font-display text-lg font-extrabold text-card sm:text-xl">
                    {item.cost}
                    <span className="ml-1 text-xs font-semibold text-ink">cred</span>
                  </span>
                  <button
                    onClick={() => void buy(item)}
                    disabled={busy === item.key || (!!token && !affordable)}
                    className="rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white shadow-md shadow-brand/25 transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40 sm:px-5 sm:py-2.5 sm:text-sm"
                  >
                    {busy === item.key ? 'Buying…' : !token ? 'Log in to buy' : affordable ? 'Buy' : 'Too pricey'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <p className="mt-10 text-center text-sm text-ink-soft">
        Power-ups are activated from the games' power-up panel.{' '}
        <Link to="/timed-challenge" className="font-semibold text-brand hover:underline">
          Play Flappy →
        </Link>
      </p>

      {toast && (
        <div
          className={`nz-pop fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${
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
