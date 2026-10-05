import { Badge, Card, EmptyState, Skeleton } from "@gdgjp/design-system";
import { Link } from "react-router";

export type GalleryItem = {
  id: string;
  thumbUrl: string;
  filename: string | null;
  chapterSlug: string | null;
};

export function GalleryGrid({
  items,
  showChapterBadge = false,
}: {
  items: GalleryItem[];
  /** Only worth showing when the viewer belongs to more than one chapter. */
  showChapterBadge?: boolean;
}) {
  if (items.length === 0) {
    return <EmptyState title="No images here yet." />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((it) => (
        <li key={it.id}>
          <Link
            to={`/i/${it.id}`}
            viewTransition
            className="group relative block overflow-hidden rounded-lg bg-surface text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="aspect-square overflow-hidden">
              <img
                src={it.thumbUrl}
                alt={it.filename ?? it.id}
                loading="lazy"
                className="size-full object-cover"
              />
            </div>
            {showChapterBadge && it.chapterSlug ? (
              <Badge className="absolute top-2 right-2 max-w-[calc(100%-1rem)] truncate">
                {it.chapterSlug}
              </Badge>
            ) : null}
            <div className="truncate px-2 py-1 text-xs text-muted">{it.id}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function GalleryGridSkeleton() {
  const skeletonIds = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      aria-label="Loading images"
      aria-busy="true"
    >
      <output className="sr-only">Loading images</output>
      {skeletonIds.map((id) => (
        <Card key={id} className="overflow-hidden p-0" aria-hidden="true">
          <Skeleton className="aspect-square h-auto w-full" />
          <div className="px-2 py-2">
            <Skeleton className="h-3 w-2/3" />
          </div>
        </Card>
      ))}
    </div>
  );
}
