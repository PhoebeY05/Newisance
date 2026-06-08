export interface NavLink {
  label: string
  to: string
}

export const navLinks: NavLink[] = [
  { label: 'Home', to: '/' },
  { label: 'Verify', to: '/verify' },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Leaderboard', to: '/leaderboard' },
]
