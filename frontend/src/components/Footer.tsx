import { Link } from 'react-router-dom'

/** Full site footer matching the Figma design: brand blurb + Quick Links,
 * Categories, and Support columns, with a copyright bar. */
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
          title="Quick Links"
          links={[
            { label: 'Home', to: '/' },
            { label: 'Verify Content', to: '/verify' },
            { label: 'Dashboard', to: '/dashboard' },
            { label: 'Leaderboard', to: '/leaderboard' },
          ]}
        />
        <FooterCol
          title="Categories"
          links={[
            { label: 'Health & Medical', to: '/verify' },
            { label: 'Politics', to: '/verify' },
            { label: 'Technology', to: '/verify' },
            { label: 'Finance', to: '/verify' },
          ]}
        />
        <FooterCol
          title="Support"
          links={[
            { label: 'Help Center', to: '/' },
            { label: 'Contact Us', to: '/' },
            { label: 'Privacy Policy', to: '/' },
            { label: 'Terms of Service', to: '/' },
          ]}
        />
      </div>

      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-6 py-5 text-center text-sm text-white/50">
          © 2025 Newisance. All rights reserved. Built to combat misinformation.
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
