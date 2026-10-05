import {
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
import { useState } from "react";
import { useNavigate } from "react-router";

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
    <Card className="flex flex-col gap-4">
      <div>
        <Inline>
          <Icons name="FolderOpen" size={16} aria-hidden="true" className="size-4" />
          <Heading className="text-base">Folder</Heading>
        </Inline>
        <Text tone="muted" size="sm">
          Organize this image within its chapter. Folders are shared with everyone in the chapter.
        </Text>
      </div>
      <div className="flex flex-col gap-2">
        <Select
          value={image.folderId !== null ? String(image.folderId) : "none"}
          onValueChange={change}
          disabled={busy}
        >
          <SelectTrigger aria-label="Folder" className="w-full sm:max-w-sm">
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
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
