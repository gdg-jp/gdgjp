import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Icons,
} from "@gdgjp/design-system";
import { useFetcher } from "react-router";
import { chapterLabel } from "~/features/auth/current-chapter";

/** Top left of the sidebar. One chapter is a plain label; several get a menu. */
export function ChapterSwitcher({
  chapters,
  chapterId,
}: { chapters: { id: number; slug: string }[]; chapterId: number }) {
  const fetcher = useFetcher();
  const current = chapters.find((c) => c.id === chapterId) ?? chapters[0];
  const label = (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="text-xs font-normal text-muted">GDG PR</span>
      <span className="truncate">{current ? chapterLabel(current.slug) : ""}</span>
    </span>
  );
  if (chapters.length < 2)
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <Icons name="Radio" size={20} aria-hidden="true" />
        {label}
      </span>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex min-w-0 items-center gap-2 rounded-md text-left"
        aria-label="チャプターを切り替える"
      >
        <Icons name="Radio" size={20} aria-hidden="true" />
        {label}
        <Icons name="ChevronsUpDown" size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>チャプター</DropdownMenuLabel>
        {chapters.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() =>
              fetcher.submit({ chapterId: String(c.id) }, { method: "post", action: "/chapter" })
            }
          >
            {c.id === current?.id ? (
              <Icons name="Check" size={14} aria-hidden="true" />
            ) : (
              <span className="inline-block w-3.5" />
            )}
            {chapterLabel(c.slug)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
