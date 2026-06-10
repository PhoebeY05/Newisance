import { Link } from 'react-router-dom'

/** Full site footer: brand blurb, product routes, games, and account links. */
export default function Footer() {
  return (
    <footer className="mt-16 bg-card text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-display text-xl font-extrabold">
            New<span className="text-secondary">isance</span>
          </p>
          <p className="mt-3 max-w-xs text-sm text-white/60">
            Helping you verify and combat misinformation, one post at a time.
          </p>
        </div>

        <FooterCol
          title="Explore"
          links={[
            { label: 'Town Hub', to: '/learn' },
            { label: 'Submit a Report', to: '/verify' },
            { label: 'Community Feed', to: '/community' },
            { label: 'Leaderboard', to: '/leaderboard' },
          ]}
        />
        <FooterCol
          title="Play"
          links={[
            { label: 'Timed Challenge', to: '/timed-challenge' },
            { label: 'Truth Tower', to: '/truth-tower' },
            { label: 'Battle Royale', to: '/battle-royale' },
            { label: 'Power-Up Shop', to: '/shop' },
          ]}
        />
        <FooterCol
          title="Account"
          links={[
            { label: 'Dashboard', to: '/dashboard' },
            { label: 'Profile', to: '/profile' },
            { label: 'Style Studio', to: '/wardrobe' },
            { label: 'Admin Tools', to: '/admin' },
          ]}
        />
      </div>

      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-6 py-5 text-center text-sm text-white/50">
          &copy; 2026 Newisance. Built to help young Singaporeans spot misinformation.
        </p>
      </div>
    </footer>
  )
}

function FooterCol({
  title,
  links,
}: {
  title: string
  links: { label: string; to: string }[]
}) {
  return (
    <div>
      <h3 className="font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link to={l.to} className="text-white/60 transition hover:text-secondary">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
