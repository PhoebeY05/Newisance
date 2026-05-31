interface PageStubProps {
  title: string
  /** Figma node id for this screen, so it's easy to build out next. */
  figmaNode: string
}

export default function PageStub({ title, figmaNode }: PageStubProps) {
  return (
    <section className="mx-auto grid max-w-7xl place-items-center px-6 py-24">
      <div className="rounded-2xl border border-black/5 bg-surface px-10 py-12 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-widest text-secondary">
          Coming soon
        </p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-card">{title}</h1>
        <p className="mt-3 max-w-md text-ink-soft">
          This screen is wired into routing and ready to build out from the design.
        </p>
        {figmaNode && (
          <p className="mt-4 text-xs text-ink-faint">
            Figma node <code className="rounded bg-black/5 px-1.5 py-0.5">{figmaNode}</code>
          </p>
        )}
      </div>
    </section>
  )
}
