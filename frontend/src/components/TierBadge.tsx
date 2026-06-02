// Credibility tier pill (Phase 8). Colour-coded grey/green/blue/gold for
// Newcomer/Verified/Analyst/Expert. Used in the profile, leaderboard, and
// anywhere a user's standing is shown.
const TIER_STYLE: Record<string, string> = {
  Newcomer: 'bg-ink-faint/15 text-ink-soft',
  Verified: 'bg-risk-low/15 text-risk-low',
  Analyst: 'bg-brand/10 text-brand',
  Expert: 'bg-highlight/25 text-ink',
}

export default function TierBadge({ tier, className = '' }: { tier: string; className?: string }) {
  const style = TIER_STYLE[tier] ?? TIER_STYLE.Newcomer
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${style} ${className}`}
    >
      {tier}
    </span>
  )
}
