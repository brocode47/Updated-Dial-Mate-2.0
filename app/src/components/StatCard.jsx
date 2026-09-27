export function StatCard({
  label,
  value,
  help,
  icon,
  trend,
  className = ''
}) {
  const Icon = icon;

  return (
    <div className={`relative overflow-hidden soft-card rounded-[var(--radius-lg)] p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-medium sm:p-6 ${className}`}>
      <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-bl-full bg-[hsl(var(--primary)/0.08)]"></div>

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          {label ? (<div className="text-sm text-[hsl(var(--foreground)/0.6)]">{label}</div> ) : null}

          <div className="mt-2 text-2xl font-semibold leading-tight md:text-3xl">
            {value ?? '—'}
          </div>

          {help ? (<div className="mt-2 text-sm text-[hsl(var(--foreground)/0.62)]">{help}</div> ) : null}

          {trend ? (
            <div className={`mt-2 text-xs font-medium ${
              trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-600' : 'text-[hsl(var(--foreground)/0.6)]'
            }`}>
              {trend > 0 ? '+' : ''}{trend}%
            </div>
           ) : null}
        </div>

        {Icon ? (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <Icon size={20} />
          </div>
         ) : null}
      </div>
    </div>
  );
}