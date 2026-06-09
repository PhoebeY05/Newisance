import { Link } from 'react-router-dom'

/** Newisance wordmark + megaphone glyph. */
export default function Logo() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2">
    <span className="grid h-9 w-9 place-items-center rounded-xl shadow-sm overflow-hidden">
      <img
        src="/flaticon.png"
        alt="Logo"
        className="h-full w-full object-contain"
      />
    </span>

    <span className="font-display text-xl font-extrabold tracking-tight text-card">
      New<span className="text-secondary">isance</span>
    </span>
  </Link>
  )
}
