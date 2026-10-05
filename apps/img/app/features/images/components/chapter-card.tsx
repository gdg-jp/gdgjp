import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Card,
  Heading,
  Icons,
  Inline,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from "@gdgjp/design-system";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

export function ChapterCard({
  image,
  chapters,
  currentChapterSlug,
}: {
  image: { id: string; chapterId: number; folderId: number | null };
  chapters: { chapterId: number; chapterSlug: string }[];
  currentChapterSlug: string;
}) {
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingChapter, setPendingChapter] = useState<string | null>(null);
  function change(value: string) {
    if (image.folderId !== null) setPendingChapter(value);
    else void applyChange(value);
  }
  async function applyChange(value: string) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("chapterId", value);
      const response = await fetch(`/api/share/${image.id}`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.text()) || "Could not update the chapter.");
      navigate(".", { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col gap-4">
      <AlertDialog
        open={pendingChapter !== null}
        onOpenChange={(open) => {
          if (!open) setPendingChapter(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <AlertDialogTitle>Share with a different chapter?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove the image from its folder.
          </AlertDialogDescription>
          <Inline className="justify-end">
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => {
                  if (pendingChapter !== null) void applyChange(pendingChapter);
                }}
              >
                Change chapter
              </Button>
            </AlertDialogAction>
          </Inline>
        </AlertDialogContent>
      </AlertDialog>
      <div>
        <Inline>
          <Icons name="Users" size={16} aria-hidden="true" className="size-4" />
          <Heading className="text-base">Chapter</Heading>
        </Inline>
        <Text tone="muted" size="sm">
          {chapters.length > 1
            ? "Members of the selected chapter can view, replace, and delete this image."
            : `Members of ${currentChapterSlug} can view, replace, and delete this image.`}
        </Text>
      </div>
      {chapters.length > 1 ? (
        <div className="flex flex-col gap-2">
          <Select value={String(image.chapterId)} onValueChange={change} disabled={busy}>
            <SelectTrigger ref={triggerRef} aria-label="Chapter" className="w-full sm:max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((chapter) => (
                <SelectItem key={chapter.chapterId} value={String(chapter.chapterId)}>
                  {chapter.chapterSlug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
