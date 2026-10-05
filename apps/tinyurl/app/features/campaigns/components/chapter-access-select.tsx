import {
  Button,
  Checkbox,
  Icons,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Stack,
} from "@gdgjp/design-system";
import { useMemo, useState } from "react";
import type { UserChapter } from "~/features/auth/chapter.server";

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
      <p className="text-xs text-muted">Members of selected chapters can manage this campaign.</p>
      {[...selectedIds].map((chapterId) => (
        <input key={chapterId} type="hidden" name="chapterId" value={chapterId} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" fullWidth className="justify-between">
            <span>
              {selectedChapters.length === 0
                ? "Select chapters"
                : `${selectedChapters.length} chapters selected`}
            </span>
            <Icons name="ChevronsUpDown" size={18} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-w-[calc(100vw-2rem)]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chapters…"
            aria-label="Search chapters"
          />
          <Stack className="mt-3 max-h-64 overflow-y-auto">
            {filteredChapters.map((chapter) => (
              <Label key={chapter.chapterId} className="flex min-h-11 items-center gap-2">
                <Checkbox
                  checked={selectedIds.has(chapter.chapterId)}
                  onCheckedChange={() => toggle(chapter.chapterId)}
                />
                {chapter.chapterSlug}
              </Label>
            ))}
            {filteredChapters.length === 0 && (
              <p className="text-sm text-muted">No matching chapters.</p>
            )}
          </Stack>
        </PopoverContent>
      </Popover>
    </fieldset>
  );
}
