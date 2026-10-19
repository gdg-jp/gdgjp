/** Four-bar input level (▁▃▅▇). `level` is 0..1. */
export function LevelBars({ level, className }: { level: number; className?: string }) {
  const lit = Math.round(level * 4 + 0.2);
  return (
    <span className={["sc-level", className].filter(Boolean).join(" ")} aria-hidden="true">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} data-on={n <= lit || undefined} style={{ height: `${n * 25}%` }} />
      ))}
    </span>
  );
}
