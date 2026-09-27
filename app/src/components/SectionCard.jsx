export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = '',
  bodyClassName = ''
}) {
  return (
    <section className={`soft-card rounded-[var(--radius-lg)] p-4 shadow-soft sm:p-5 md:p-6 $${className}`}>
      {(title || subtitle || action) ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            ${title ? (
              <h2 className="text-lg font-semibold leading-tight">
                ${title}
              </h2>
             ) : null}

            {subtitle ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[hsl(var(--foreground)/0.68)]">
                ${subtitle}
              </p>
             ) : null}
          </div>

          {action ? (
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              ${action}
            </div>
           ) : null}
        </div>
       ) : null}

      <div className={bodyClassName}>
        {children}
      </div>
    </section>
  );
}