import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useApi } from '../hooks/useApi'

/**
 * Account — "My Account" screen (Figma node 89:221). Sidebar profile card +
 * nav, with a Profile Information form (Personal Details + Change Password).
 */
export default function Account() {
  const navigate = useNavigate()
  const apiFetch = useApi()
  const { user, logout, patchUser } = useAuth()
  const [activeTab, setActiveTab] = useState<AccountTab>('Profile')
  const [username, setUsername] = useState(user?.username ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const displayName = user?.username ?? 'Newisance User'
  const displayEmail = user?.email ?? 'signed in'
  const credibilityScore = Math.max(0, Math.min(100, user?.credibility_score ?? 0))
  const voteWeight = user?.is_guest ? 0.1 : Math.min(credibilityScore / 100, 1)
  const isGuest = user?.is_guest ?? false

  useEffect(() => {
    setUsername(user?.username ?? '')
    setEmail(user?.email ?? '')
  }, [user?.username, user?.email])

  const resetForm = () => {
    setUsername(user?.username ?? '')
    setEmail(user?.email ?? '')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setStatusMessage(null)
  }

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setStatusMessage(null)

    if (isGuest) {
      setError('Guest accounts cannot change account details. Create a member account to save changes.')
      return
    }

    if (newPassword || confirmPassword || currentPassword) {
      if (newPassword !== confirmPassword) {
        setError('New passwords do not match')
        return
      }
      if (!currentPassword) {
        setError('Enter your current password to set a new one')
        return
      }
    }

    const payload: {
      username?: string
      email?: string
      current_password?: string
      new_password?: string
    } = {}

    if (username.trim() !== user?.username) payload.username = username.trim()
    if (email.trim() !== user?.email) payload.email = email.trim()
    if (newPassword) {
      payload.current_password = currentPassword
      payload.new_password = newPassword
    }

    if (Object.keys(payload).length === 0) {
      setStatusMessage('No changes to save')
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch('/api/community/users/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      const updatedUser = await response.json()
      patchUser(updatedUser)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setStatusMessage('Account updated')
    } catch (err) {
      setError(readErrorMessage(err, 'Could not update account'))
    } finally {
      setSaving(false)
    }
  }

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
            {sidebarLinks.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setActiveTab(l)}
                className={`block w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                  activeTab === l ? 'bg-brand text-white' : 'text-ink-soft hover:bg-bg hover:text-ink'
                }`}
              >
                {l}
              </button>
            ))}
          </nav>
        </aside>

        <section className="rounded-3xl border border-black/5 bg-surface p-5 shadow-sm sm:p-8">
          {activeTab === 'Profile' ? (
            <>
              <h2 className="font-display text-2xl font-extrabold text-card">Profile Information</h2>
              <p className="mt-2 text-sm text-ink-soft">Keep your public display name and login email up to date.</p>

              <form className="mt-6 space-y-8" onSubmit={handleSave}>
                <div>
                  <h3 className="font-display text-lg font-bold text-card">Personal Details</h3>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <Field
                      label="Username"
                      value={username}
                      onChange={setUsername}
                      placeholder="Choose a display name"
                      disabled={isGuest || saving}
                    />
                    <Field
                      label="Email Address"
                      type="email"
                      value={email}
                      onChange={setEmail}
                      placeholder="you@example.com"
                      disabled={isGuest || saving}
                    />
                  </div>
                </div>

                <FormMessages error={error} statusMessage={statusMessage} />
                <FormActions saving={saving} isGuest={isGuest} resetForm={resetForm} />
              </form>
            </>
          ) : null}

          {activeTab === 'Settings' ? (
            <>
              <h2 className="font-display text-2xl font-extrabold text-card">Settings</h2>
              <p className="mt-2 text-sm text-ink-soft">Control your password and account security details.</p>

              <form className="mt-6 space-y-8" onSubmit={handleSave}>
                <div>
                  <h3 className="font-display text-lg font-bold text-card">Change Password</h3>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Field
                        label="Current Password"
                        type="password"
                        value={currentPassword}
                        onChange={setCurrentPassword}
                        placeholder="Enter current password"
                        disabled={isGuest || saving}
                      />
                    </div>
                    <Field
                      label="New Password"
                      type="password"
                      value={newPassword}
                      onChange={setNewPassword}
                      placeholder="Enter new password"
                      disabled={isGuest || saving}
                    />
                    <Field
                      label="Confirm New Password"
                      type="password"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      placeholder="Confirm new password"
                      disabled={isGuest || saving}
                    />
                  </div>
                </div>

                <div className="grid gap-3 border-t border-black/5 pt-6 sm:grid-cols-2">
                  <InfoTile title="Account Type" value={isGuest ? 'Guest' : 'Member'} />
                  <InfoTile title="Vote Weight" value={`${voteWeight.toFixed(2)}x`} />
                </div>

                <FormMessages error={error} statusMessage={statusMessage} />
                <FormActions saving={saving} isGuest={isGuest} resetForm={resetForm} />
              </form>
            </>
          ) : null}

          {activeTab === 'My Activity' ? (
            <MyActivity
              credibilityScore={credibilityScore}
              voteWeight={voteWeight}
              tier={user?.tier ?? 'Newcomer'}
              navigate={navigate}
            />
          ) : null}

          <div className="mt-6 border-t border-black/5 pt-6">
            <button
              type="button"
              onClick={() => {
                logout()
                navigate('/login')
              }}
              className="w-full rounded-xl bg-risk-critical/10 px-6 py-3 text-sm font-bold text-risk-critical transition hover:bg-risk-critical/20 sm:w-auto"
            >
              Logout
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

type AccountTab = 'Profile' | 'Settings' | 'My Activity'

const sidebarLinks: AccountTab[] = ['Profile', 'Settings', 'My Activity']

function FormMessages({ error, statusMessage }: { error: string | null; statusMessage: string | null }) {
  return (
    <>
      {error ? <p className="text-sm font-semibold text-risk-critical">{error}</p> : null}
      {statusMessage ? <p className="text-sm font-semibold text-brand">{statusMessage}</p> : null}
    </>
  )
}

function FormActions({
  saving,
  isGuest,
  resetForm,
}: {
  saving: boolean
  isGuest: boolean
  resetForm: () => void
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row sm:flex-wrap sm:items-center">
      <button
        disabled={saving || isGuest}
        className="w-full rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
      <button
        type="button"
        onClick={resetForm}
        disabled={saving}
        className="w-full rounded-xl border border-black/10 px-6 py-3 text-sm font-bold text-ink-soft transition hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        Cancel
      </button>
    </div>
  )
}

function InfoTile({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl bg-bg p-4">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-soft">{title}</p>
      <p className="mt-1 font-display text-2xl font-extrabold text-card">{value}</p>
    </div>
  )
}

function MyActivity({
  credibilityScore,
  voteWeight,
  tier,
  navigate,
}: {
  credibilityScore: number
  voteWeight: number
  tier: string
  navigate: ReturnType<typeof useNavigate>
}) {
  const roundedScore = Math.round(credibilityScore)

  return (
    <div>
      <h2 className="font-display text-2xl font-extrabold text-card">My Activity</h2>
      <p className="mt-2 text-sm text-ink-soft">A quick snapshot of your reputation and the places you are most likely to use next.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <InfoTile title="Credibility" value={`${roundedScore}/100`} />
        <InfoTile title="Tier" value={tier} />
        <InfoTile title="Vote Weight" value={`${voteWeight.toFixed(2)}x`} />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <ActivityAction
          title="Credibility History"
          description="Review score changes from games and verification votes."
          action="Open profile"
          onClick={() => navigate('/profile')}
        />
        <ActivityAction
          title="Community Votes"
          description="Check new suspicious posts and keep your vote accuracy moving."
          action="Go verify"
          onClick={() => navigate('/verify')}
        />
        <ActivityAction
          title="Leaderboard"
          description="Compare your standing with other fact-checkers."
          action="View ranks"
          onClick={() => navigate('/leaderboard')}
        />
        <ActivityAction
          title="Timed Challenge"
          description="Play a short round to improve your score and sharpen pattern spotting."
          action="Play now"
          onClick={() => navigate('/play/timed')}
        />
      </div>
    </div>
  )
}

function ActivityAction({
  title,
  description,
  action,
  onClick,
}: {
  title: string
  description: string
  action: string
  onClick: () => void
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-bg p-5">
      <h3 className="font-display text-lg font-extrabold text-card">{title}</h3>
      <p className="mt-2 min-h-12 text-sm leading-6 text-ink-soft">{description}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light"
      >
        {action}
      </button>
    </div>
  )
}

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
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [showPassword, setShowPassword] = useState(false)
  const isPassword = type === 'password'
  const inputType = isPassword && showPassword ? 'text' : type

  return (
    <label className="block">
      <span className="text-sm font-semibold text-card">{label}</span>
      <span className="relative mt-1.5 block">
        <input
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={isPassword ? 'current-password' : undefined}
          className="w-full rounded-xl border border-black/10 bg-bg px-4 py-2.5 pr-16 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            disabled={disabled}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-bold text-brand transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        ) : null}
      </span>
    </label>
  )
}

function readErrorMessage(err: unknown, fallback: string) {
  if (!(err instanceof Error)) return fallback
  try {
    const parsed = JSON.parse(err.message) as { detail?: unknown }
    if (typeof parsed.detail === 'string') return parsed.detail
    if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
      const first = parsed.detail[0] as { msg?: unknown }
      if (typeof first.msg === 'string') return first.msg
    }
    return fallback
  } catch {
    return err.message || fallback
  }
}
