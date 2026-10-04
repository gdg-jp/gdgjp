import type { CSSProperties } from "react";
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
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        No images here yet.
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((it, index) => (
        <li
          key={it.id}
          className="motion-stagger"
          style={{ "--motion-index": index } as CSSProperties}
        >
          <Link
            to={`/i/${it.id}`}
            viewTransition
            className="group relative block overflow-hidden rounded-md border bg-muted/40 shadow-sm transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-ring hover:shadow-lg focus-visible:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="aspect-square overflow-hidden">
              <img
                src={it.thumbUrl}
                alt={it.filename ?? it.id}
                loading="lazy"
                className="motion-image-reveal size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
              />
            </div>
            {showChapterBadge && it.chapterSlug ? (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm">
                {it.chapterSlug}
              </span>
            ) : null}
            <div className="truncate px-2 py-1 text-xs text-muted-foreground">{it.id}</div>
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
      {skeletonIds.map((id) => (
        <div key={id} className="overflow-hidden rounded-md border bg-muted/40" aria-hidden="true">
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="px-2 py-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
