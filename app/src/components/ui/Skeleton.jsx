import React from 'react';

export function Skeleton({ className = '', variant = 'rectangular' }) {
  const variantStyles = {
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
    text: 'rounded h-4 w-full'
  };

  return (
    <div
      className={`animate-pulse bg-slate-200/80 ${variantStyles[variant] || 'rounded-lg'} ${className}`}
    />
  );
}

export function TableSkeletonRows({ rows = 5, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <tr key={rIdx} className="border-b border-slate-100 animate-pulse">
          {Array.from({ length: cols }).map((_, cIdx) => (
            <td key={cIdx} className="px-5 py-4">
              <div
                className={`h-4 bg-slate-100 rounded ${
                  cIdx === 0 ? 'w-20' : cIdx === 1 ? 'w-32' : cIdx === 2 ? 'w-16' : 'w-24'
                }`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left">
        <tbody>
          <TableSkeletonRows rows={rows} cols={cols} />
        </tbody>
      </table>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-soft animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 bg-slate-200 rounded w-24" />
        <div className="w-8 h-8 bg-slate-200 rounded-lg" />
      </div>
      <div className="h-8 bg-slate-200 rounded w-20 mb-2" />
      <div className="h-3 bg-slate-100 rounded w-32" />
    </div>
  );
}
