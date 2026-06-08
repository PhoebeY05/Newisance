import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'

interface AuthFormProps {
  mode: 'login' | 'signup'
}

/**
 * Shared auth screen for Login (Figma 39:209) and Signup (39:211). A single
 * centered card with email/password fields, social sign-in (Google /
 * Facebook), and a mode-switch link. Presentational only — no real auth.
 */
export default function AuthForm({ mode }: AuthFormProps) {
  const isSignup = mode === 'signup'
  const navigate = useNavigate()
  const { login, register, loginWithGoogle, loginAsGuest } = useAuth()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      if (isSignup) {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match')
        }
        await register({ username, email, password })
      } else {
        await login({ email, password })
      }
      navigate('/account')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGuestLogin = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await loginAsGuest()
      navigate('/profile')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guest login failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await loginWithGoogle()
      navigate('/account')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl place-items-center px-6 py-12">
      <div className="w-full max-w-md rounded-3xl border border-black/5 bg-surface p-8 shadow-sm">
        <h1 className="text-center font-display text-3xl font-extrabold text-card">
          {isSignup ? 'Create Account' : 'Welcome Back'}
        </h1>
        <p className="mt-2 text-center text-sm text-ink-soft">
          {isSignup
            ? 'Join the fight against misinformation'
            : 'Login to continue fighting misinformation'}
        </p>

        <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
          {isSignup && <Field label="Username" type="text" value={username} onChange={setUsername} placeholder="Choose a unique username" />}

          <Field label="Email Address" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />

          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={isSignup ? 'Must be at least 8 characters' : '••••••••'}
          />

          {isSignup && (
            <Field
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter your password"
            />
          )}

          {error ? <p className="text-sm font-medium text-risk-critical">{error}</p> : null}

          {!isSignup ? (
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-ink-soft">
                <input type="checkbox" className="accent-brand" /> Remember me
              </label>
              <Link to="/login" className="font-medium text-brand hover:underline">
                Forgot password?
              </Link>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-ink-soft">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-brand" />
                <span>I agree to the Terms of Service and Privacy Policy</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-brand" />
                <span>Send me updates about new features and misinformation alerts</span>
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Please wait...' : isSignup ? 'Create Account' : 'Login'}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs font-medium text-ink-faint">
          <span className="h-px flex-1 bg-black/10" />
          {isSignup ? 'or sign up with' : 'or continue with'}
          <span className="h-px flex-1 bg-black/10" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SocialButton label="Google" emoji="🔴" onClick={handleGoogleLogin} disabled={submitting} />
          <SocialButton label="Facebook" emoji="🔵" disabled={submitting} />
        </div>

        {!isSignup ? (
          <button
            type="button"
            onClick={handleGuestLogin}
            disabled={submitting}
            className="mt-3 w-full rounded-xl border border-brand/20 bg-brand/5 py-3 text-sm font-bold text-brand transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue as Guest
          </button>
        ) : null}

        <p className="mt-6 text-center text-sm text-ink-soft">
          {isSignup ? (
            <>
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-brand hover:underline">
                Login
              </Link>
            </>
          ) : (
            <>
              Don't have an account?{' '}
              <Link to="/signup" className="font-semibold text-brand hover:underline">
                Sign up
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function Field({
  label,
  type,
  placeholder,
  value,
  onChange,
}: {
  label: string
  type: string
  placeholder: string
  value?: string
  onChange?: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-card">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </label>
  )
}

function SocialButton({
  label,
  emoji,
  onClick,
  disabled = false,
}: {
  label: string
  emoji: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-surface py-2.5 text-sm font-semibold text-ink transition hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </button>
  )
}
