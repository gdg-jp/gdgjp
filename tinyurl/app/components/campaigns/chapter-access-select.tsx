import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import type { UserChapter } from "~/lib/chapter.server";

export function ChapterAccessSelect({
  chapters,
  defaultChapterIds,
}: {
  chapters: UserChapter[];
  defaultChapterIds: number[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set(defaultChapterIds));
  const filteredChapters = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? chapters.filter((chapter) => chapter.chapterSlug.toLowerCase().includes(normalized))
      : chapters;
  }, [chapters, query]);
  const selectedChapters = chapters.filter((chapter) => selectedIds.has(chapter.chapterId));

  function toggle(chapterId: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Chapters with access</legend>
      <p className="text-xs text-muted-foreground">
        Members of selected chapters can manage this campaign.
      </p>
      {[...selectedIds].map((chapterId) => (
        <input key={chapterId} type="hidden" name="chapterId" value={chapterId} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between font-normal">
            <span className="truncate">
              {selectedChapters.length === 0
                ? "Select chapters"
                : selectedChapters.length === 1
                  ? selectedChapters[0].chapterSlug
                  : `${selectedChapters.length} chapters selected`}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <div className="border-b p-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chapters…"
              aria-label="Search chapters"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredChapters.map((chapter) => {
              const selected = selectedIds.has(chapter.chapterId);
              return (
                <button
                  key={chapter.chapterId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(chapter.chapterId)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="flex size-4 items-center justify-center">
                    {selected ? <Check className="size-4" /> : null}
                  </span>
                  {chapter.chapterSlug}
                </button>
              );
            })}
            {filteredChapters.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No matching chapters.</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </fieldset>
  );
}
