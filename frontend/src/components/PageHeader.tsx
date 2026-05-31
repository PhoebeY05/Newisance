interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
}

/** Consistent page heading used across the main screens. */
export default function PageHeader({ eyebrow, title, subtitle }: PageHeaderProps) {
  return (
    <header className="mb-8">
      {eyebrow && (
        <p className="text-sm font-semibold uppercase tracking-widest text-secondary">{eyebrow}</p>
      )}
      <h1 className="mt-1 font-display text-3xl font-extrabold text-card sm:text-4xl">{title}</h1>
      {subtitle && <p className="mt-3 max-w-2xl text-lg text-ink-soft">{subtitle}</p>}
    </header>
  )
}
