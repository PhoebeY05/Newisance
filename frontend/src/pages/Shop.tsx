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
          fetch(`${API}/items`),
          token ? fetch(`${API}/inventory`, { headers }) : Promise.resolve(null),
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
          flash('err', 'Purchase failed — try again')
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
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold text-card sm:text-5xl">
            ⚡ Power-Up Shop
          </h1>
          <p className="mt-3 max-w-xl text-lg text-ink-soft">
            Spend your hard-earned credibility on power-ups that give you an edge in the games.
          </p>
        </div>
        <div className="rounded-3xl bg-card px-6 py-4 text-center text-white shadow-lg shadow-card/20">
          <p className="text-xs uppercase tracking-wide text-white/50">Your credibility</p>
          <p className="font-display text-3xl font-extrabold text-secondary">{credibility}</p>
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
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const owned = inventory[item.key] ?? 0
            const affordable = credibility >= item.cost
            return (
              <article
                key={item.key}
                className="flex flex-col rounded-3xl border border-black/5 bg-surface p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="flex items-start justify-between">
                  <span className="grid h-16 w-16 place-items-center rounded-2xl bg-bg text-4xl">
                    {item.emoji}
                  </span>
                  {owned > 0 && (
                    <span className="rounded-full bg-secondary/15 px-3 py-1 text-xs font-bold text-secondary">
                      Owned ×{owned}
                    </span>
                  )}
                </div>
                <h2 className="mt-4 font-display text-2xl font-extrabold text-card">{item.name}</h2>
                <span className="mt-1 w-fit rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand">
                  {GAME_LABEL[item.game]}
                </span>
                <p className="mt-3 flex-1 text-sm text-ink-soft">{item.description}</p>
                <div className="mt-6 flex items-center justify-between">
                  <span className="font-display text-xl font-extrabold text-card">
                    {item.cost}
                    <span className="ml-1 text-xs font-semibold text-ink-soft">cred</span>
                  </span>
                  <button
                    onClick={() => void buy(item)}
                    disabled={busy === item.key || (!!token && !affordable)}
                    className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-brand/25 transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40"
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
