import { NavLink as RouterNavLink, Link } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import Logo from './Logo'
import { navLinks } from '../data/nav'

export default function Navbar() {
  const { user, token, logout } = useAuth()

  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-surface/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6">
        <Logo />

        <ul className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <li key={link.to}>
              <RouterNavLink
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  [
                    'relative text-sm font-medium transition-colors',
                    isActive
                      ? 'text-brand after:absolute after:-bottom-1.5 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-brand'
                      : 'text-ink-soft hover:text-ink',
                  ].join(' ')
                }
              >
                {link.label}
              </RouterNavLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          {token ? (
            <>
              <Link
                to="/profile"
                className="hidden items-center gap-2 rounded-full bg-bg px-3 py-1.5 text-sm font-medium text-card transition hover:bg-secondary/20 md:flex"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  {(user?.username?.slice(0, 2) ?? 'U').toUpperCase()}
                </span>
                <span>{user?.username ?? 'Account'}</span>
              </Link>
              {user?.is_admin && (
                <Link
                  to="/admin"
                  className="hidden rounded-full bg-card px-3 py-1.5 text-sm font-bold text-white transition hover:opacity-90 md:block"
                >
                  Admin
                </Link>
              )}
              <Link
                to="/account"
                aria-label="My account"
                className="grid h-9 w-9 place-items-center rounded-full bg-bg text-card transition hover:bg-secondary/20"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M5 19a7 7 0 0 1 14 0"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </Link>
              <button
                type="button"
                onClick={logout}
                className="rounded-full border border-black/10 px-4 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-bg hover:text-ink"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-ink-soft hover:text-ink">
                Login
              </Link>
              <Link
                to="/signup"
                className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-light"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
