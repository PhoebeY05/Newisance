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

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-card sm:text-4xl">My Account</h1>
        <p className="mt-2 text-lg text-ink-soft">Manage your profile and account settings</p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[20rem_1fr]">
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

            <div className="mt-6 grid grid-cols-2 gap-3">
              {miniStats.map((s) => (
                <div key={s.label} className="rounded-2xl bg-bg p-3">
                  <p className="font-display text-lg font-extrabold text-card">{s.value}</p>
                  <p className="text-xs text-ink-soft">{s.label}</p>
                </div>
              ))}
            </div>
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
        <section className="rounded-3xl border border-black/5 bg-surface p-8 shadow-sm">
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

            <div className="flex flex-wrap items-center gap-3 border-t border-black/5 pt-6">
              <button className="rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-light">
                Save Changes
              </button>
              <button
                type="button"
                className="rounded-xl border border-black/10 px-6 py-3 text-sm font-bold text-ink-soft transition hover:bg-bg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
                className="ml-auto rounded-xl bg-risk-critical/10 px-6 py-3 text-sm font-bold text-risk-critical transition hover:bg-risk-critical/20"
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

const miniStats = [
  { value: '782', label: 'Score' },
  { value: '84%', label: 'Accuracy' },
  { value: '127', label: 'Verified' },
  { value: '15', label: 'Streak' },
]

const sidebarLinks = ['Profile', 'Settings', 'My Activity', 'Preferences']

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
