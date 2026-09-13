import { Skeleton as UiSkeleton } from "@gdgjp/ui";

export { UiSkeleton as Skeleton };

export function ListItemSkeleton() {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <UiSkeleton className="h-4 w-3/5" />
      <UiSkeleton className="h-3 w-12" />
    </div>
  );
}

const SLOTS = Array.from({ length: 32 }, (_, i) => `slot-${i}`);

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {SLOTS.slice(0, rows).map((key) => (
        <ListItemSkeleton key={key} />
      ))}
    </div>
  );
}

export function ArticleSkeleton() {
  return (
    <div className="space-y-6">
      {/* Paragraph blocks */}
      <div className="space-y-2">
        <UiSkeleton className="h-4 w-full" />
        <UiSkeleton className="h-4 w-5/6" />
        <UiSkeleton className="h-4 w-4/5" />
      </div>
      <div className="space-y-2">
        <UiSkeleton className="h-4 w-full" />
        <UiSkeleton className="h-4 w-3/4" />
      </div>
      {/* Subheading + block */}
      <UiSkeleton className="h-6 w-1/3" />
      <div className="space-y-2">
        <UiSkeleton className="h-4 w-full" />
        <UiSkeleton className="h-4 w-5/6" />
        <UiSkeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function ArticleWithTitleSkeleton() {
  return (
    <div className="space-y-6">
      {/* Title placeholder */}
      <UiSkeleton className="h-8 w-2/3" />
      {/* Paragraph blocks */}
      <div className="space-y-2">
        <UiSkeleton className="h-4 w-full" />
        <UiSkeleton className="h-4 w-5/6" />
        <UiSkeleton className="h-4 w-4/5" />
      </div>
      <div className="space-y-2">
        <UiSkeleton className="h-4 w-full" />
        <UiSkeleton className="h-4 w-3/4" />
      </div>
      {/* Subheading + block */}
      <UiSkeleton className="h-6 w-1/3" />
      <div className="space-y-2">
        <UiSkeleton className="h-4 w-full" />
        <UiSkeleton className="h-4 w-5/6" />
        <UiSkeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function TocSkeleton() {
  return (
    <aside className="hidden w-56 shrink-0 py-6 pr-4 md:block">
      <UiSkeleton className="mb-4 h-4 w-24" />
      <div className="space-y-2">
        <UiSkeleton className="h-3 w-40" />
        <UiSkeleton className="h-3 w-32 pl-3" />
        <UiSkeleton className="h-3 w-36 pl-3" />
        <UiSkeleton className="h-3 w-28" />
        <UiSkeleton className="h-3 w-36 pl-3" />
      </div>
    </aside>
  );
}

export function MetaBarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <UiSkeleton className="h-6 w-16 rounded-full" />
      <UiSkeleton className="h-6 w-20 rounded-full" />
      <UiSkeleton className="h-6 w-14 rounded-full" />
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SLOTS.slice(0, count).map((key) => (
        <div
          key={key}
          className="flex h-44 flex-col justify-between rounded-xl border border-border bg-surface p-5"
        >
          <div className="space-y-2">
            <UiSkeleton className="h-5 w-4/5" />
            <UiSkeleton className="h-4 w-full" />
            <UiSkeleton className="h-4 w-2/3" />
          </div>
          <UiSkeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const colKeys = SLOTS.slice(0, cols);
  const rowKeys = SLOTS.slice(0, rows);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border bg-neutral p-3">
        <div className="flex items-center gap-4">
          {colKeys.map((cKey) => (
            <UiSkeleton key={cKey} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-border-border">
        {rowKeys.map((rKey) => (
          <div key={rKey} className="flex items-center gap-4 p-3">
            {colKeys.map((cKey) => (
              <UiSkeleton key={`${rKey}-${cKey}`} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
