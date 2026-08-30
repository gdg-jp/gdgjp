import { Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(value: string) {
    if (
      image.folderId !== null &&
      !confirm("Sharing with a different chapter will remove this image from its folder. Continue?")
    )
      return;
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
    <Card
      className="motion-stagger transition-shadow duration-300 hover:shadow-md"
      style={{ "--motion-index": 5 } as React.CSSProperties}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" /> Chapter
        </CardTitle>
        <CardDescription>
          {chapters.length > 1
            ? "Members of the selected chapter can view, replace, and delete this image."
            : `Members of ${currentChapterSlug} can view, replace, and delete this image.`}
        </CardDescription>
      </CardHeader>
      {chapters.length > 1 ? (
        <CardContent className="flex flex-col gap-2">
          <Select value={String(image.chapterId)} onValueChange={change} disabled={busy}>
            <SelectTrigger className="w-56">
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
