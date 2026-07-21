interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-gray-200 motion-reduce:animate-none ${className}`} />;
}

export function ListItemSkeleton() {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
        <ListItemSkeleton key={i} />
      ))}
    </div>
  );
}
