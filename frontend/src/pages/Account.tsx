import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'

/**
 * Account — "My Account" screen (Figma node 89:221). Sidebar profile card +
 * nav, with a Profile Information form (Personal Details + Change Password).
 */
export default function Account() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const displayName = user?.username ?? 'Newisance User'
  const displayEmail = user?.email ?? 'signed in'
  const initialName = user?.username ?? ''
  const credibilityScore = Math.max(0, Math.min(100, user?.credibility_score ?? 0))
  const voteWeight = user?.is_guest ? 0.1 : Math.min(credibilityScore / 100, 1)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-card sm:text-4xl">My Account</h1>
        <p className="mt-2 text-lg text-ink-soft">Manage your profile and account settings</p>
      </header>

      <div className="mt-6 grid gap-6 sm:mt-8 lg:grid-cols-[20rem_1fr] lg:gap-8">
        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="rounded-3xl border border-black/5 bg-surface p-6 text-center shadow-sm">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-brand text-2xl font-extrabold text-white">
              {(user?.username?.slice(0, 2) ?? 'U').toUpperCase()}
            </span>
            <p className="mt-4 font-display text-xl font-extrabold text-card">{displayName}</p>
            <p className="text-sm text-ink-soft">{displayEmail}</p>
            <span className="mt-2 inline-block rounded-full bg-secondary/15 px-3 py-1 text-xs font-bold text-secondary">
              {user?.is_guest ? 'Guest' : 'Member'}
            </span>

            <CredibilityPie score={credibilityScore} voteWeight={voteWeight} />

          </div>

          <nav className="rounded-3xl border border-black/5 bg-surface p-3 shadow-sm">
            {sidebarLinks.map((l, i) => (
              <button
                key={l}
                className={`block w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                  i === 0 ? 'bg-brand text-white' : 'text-ink-soft hover:bg-bg hover:text-ink'
                }`}
              >
                {l}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main form */}
        <section className="rounded-3xl border border-black/5 bg-surface p-5 shadow-sm sm:p-8">
          <h2 className="font-display text-2xl font-extrabold text-card">Profile Information</h2>

          <form className="mt-6 space-y-8" onSubmit={(e) => e.preventDefault()}>
            <div>
              <h3 className="font-display text-lg font-bold text-card">Personal Details</h3>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Field label="First Name" defaultValue={initialName} placeholder="Enter first name" />
                <Field label="Last Name" placeholder="Enter last name" />
                <Field label="Email Address" type="email" defaultValue={displayEmail} />
                <Field label="Username" defaultValue={displayName} />
                <div className="sm:col-span-2">
                  <Field label="Bio" placeholder="Tell people what you care about" />
                </div>
              </div>
            </div>

            <div className="border-t border-black/5 pt-8">
              <h3 className="font-display text-lg font-bold text-card">Change Password</h3>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Current Password" type="password" placeholder="Enter current password" />
                </div>
                <Field label="New Password" type="password" placeholder="Enter new password" />
                <Field label="Confirm New Password" type="password" placeholder="Confirm new password" />
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row sm:flex-wrap sm:items-center">
              <button className="w-full rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-light sm:w-auto">
                Save Changes
              </button>
              <button
                type="button"
                className="w-full rounded-xl border border-black/10 px-6 py-3 text-sm font-bold text-ink-soft transition hover:bg-bg sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
                className="w-full rounded-xl bg-risk-critical/10 px-6 py-3 text-sm font-bold text-risk-critical transition hover:bg-risk-critical/20 sm:ml-auto sm:w-auto"
              >
                Logout
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

const sidebarLinks = ['Profile', 'Settings', 'My Activity', 'Preferences']

function CredibilityPie({ score, voteWeight }: { score: number; voteWeight: number }) {
  const [showInfo, setShowInfo] = useState(false)
  const roundedScore = Math.round(score)
  const remaining = 100 - roundedScore

  return (
    <div className="relative mt-6 rounded-3xl border border-black/5 bg-bg p-4 text-left">
      <button
        type="button"
        onClick={() => setShowInfo(true)}
        aria-label="Learn how credibility works"
        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-surface text-sm font-extrabold text-brand shadow-sm ring-1 ring-black/5 transition hover:bg-brand hover:text-white"
      >
        i
      </button>

      <div className="flex items-center justify-center">
        <div
          className="grid h-32 w-32 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(#29449e ${roundedScore * 3.6}deg, #e8e8e8 0deg)`,
          }}
          aria-label={`Credibility score ${roundedScore} out of 100`}
        >
          <div className="grid h-24 w-24 place-items-center rounded-full bg-surface shadow-inner">
            <div className="text-center">
              <p className="font-display text-3xl font-extrabold text-card">{roundedScore}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">Cred</p>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-2xl bg-surface px-3 py-2">
          <p className="font-display text-lg font-extrabold text-brand">{roundedScore}%</p>
          <p className="text-[11px] text-ink-soft">Trusted signal</p>
        </div>
        <div className="rounded-2xl bg-surface px-3 py-2">
          <p className="font-display text-lg font-extrabold text-ink-soft">{remaining}%</p>
          <p className="text-[11px] text-ink-soft">Room to grow</p>
        </div>
      </div>

      {showInfo && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-card/35 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-surface p-6 text-left shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Credibility</p>
                <h3 className="mt-1 font-display text-xl font-extrabold text-card">How your score is used</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                aria-label="Close credibility info"
                className="grid h-8 w-8 place-items-center rounded-full bg-bg text-lg font-bold text-ink-soft transition hover:bg-brand hover:text-white"
              >
                x
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              Your credibility shows how reliable your Real/Fake calls have been. When you vote on verification posts, a higher credibility score gives your vote more influence in the community result.
            </p>
            <div className="mt-4 rounded-2xl bg-bg p-4 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">Your current vote weight</p>
              <p className="mt-1 font-display text-3xl font-extrabold text-brand">{voteWeight.toFixed(2)}x</p>
            </div>
            <button
              type="button"
              onClick={() => setShowInfo(false)}
              className="mt-5 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-light"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  type = 'text',
  defaultValue,
  placeholder,
}: {
  label: string
  type?: string
  defaultValue?: string
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-card">{label}</span>
      <input
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </label>
  )
}
