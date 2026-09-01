/** Shimmering placeholder blocks for loading states (native feel: no more "Loading…" text). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton bg-set-panel2/60 rounded-lg ${className}`} />;
}

/** Page-shaped skeleton: title line + paragraph lines. */
export function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6">
      <Skeleton className="h-8 w-2/3 mb-4" />
      <div className="space-y-2.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <Skeleton className="h-24 w-full mt-6" />
    </div>
  );
}

/** Graph-shaped skeleton: scattered node dots. */
export function GraphSkeleton() {
  const dots = [
    { l: '18%', t: '22%', s: 14 }, { l: '42%', t: '14%', s: 10 }, { l: '68%', t: '30%', s: 18 },
    { l: '30%', t: '52%', s: 12 }, { l: '55%', t: '66%', s: 16 }, { l: '78%', t: '58%', s: 9 },
    { l: '12%', t: '74%', s: 10 }, { l: '46%', t: '38%', s: 8 },
  ];
  return (
    <div className="relative h-full w-full overflow-hidden">
      {dots.map((d, i) => (
        <div
          key={i}
          className="skeleton bg-set-panel2/60 absolute rounded-full"
          style={{ left: d.l, top: d.t, width: d.s, height: d.s }}
        />
      ))}
    </div>
  );
}
