import { NavLink as RouterNavLink, Link } from 'react-router-dom'
import Logo from './Logo'
import { navLinks } from '../data/nav'

export default function Navbar() {
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
          <Link to="/login" className="text-sm font-medium text-ink-soft hover:text-ink">
            Login
          </Link>
          <Link
            to="/signup"
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-light"
          >
            Sign up
          </Link>
        </div>
      </nav>
    </header>
  )
}
