import { FolderOpen } from "lucide-react";
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

export function FolderCard({
  image,
  folders,
}: { image: { id: string; folderId: number | null }; folders: { id: number; name: string }[] }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(value: string) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("folderId", value === "none" ? "" : value);
      const response = await fetch(`/api/move/${image.id}`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.text()) || "Could not move the image.");
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
      style={{ "--motion-index": 4 } as React.CSSProperties}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" /> Folder
        </CardTitle>
        <CardDescription>
          Organize this image within its chapter. Folders are shared with everyone in the chapter.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Select
          value={image.folderId !== null ? String(image.folderId) : "none"}
          onValueChange={change}
          disabled={busy}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No folder</SelectItem>
            {folders.map((folder) => (
              <SelectItem key={folder.id} value={String(folder.id)}>
                {folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
