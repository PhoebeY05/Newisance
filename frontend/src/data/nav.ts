export interface NavLink {
  label: string
  to: string
}

export const navLinks: NavLink[] = [
  { label: 'Home', to: '/' },
  { label: 'Play', to: '/learn' },
  { label: 'Verify', to: '/verify' },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Leaderboard', to: '/leaderboard' },
]
