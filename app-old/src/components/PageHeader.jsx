export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  compact = false
}) {
  return (
    <div
      className={`flex flex-col gap-4 ${
        compact ? '' : 'mb-6 md:mb-8'
      } md:flex-row md:items-end md:justify-between`}
    >
      <div className="min-w-0">
        {eyebrow
          ? (<div className="text-xs uppercase tracking-[0.18em] text-[hsl(var(--foreground)/0.55)]">
              {eyebrow}
            </div> ) : null}

        <h1 className="mt-1 text-2xl font-semibold leading-tight md:text-4xl">
          {title}
        </h1>

        {description
          ? (<p className="mt-2 max-w-2xl text-sm text-[hsl(var(--foreground)/0.72)] md:text-base">
              {description}
            </p> ) : null}
      </div>

      {actions
        ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
              {actions}
            </div>
           ) : null}
    </div>
  );
}