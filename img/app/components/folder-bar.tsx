import type { UserChapter } from "@gdgjp/gdg-lib";
import { FolderPlus, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

export type FolderSummary = {
  id: number;
  chapterId: number;
  name: string;
  imageCount: number;
};

/** "all" = every visible image, "unfiled" = no folder, number = one folder's id. */
export type FolderSelection = "all" | "unfiled" | number;

export function FolderBar({
  folders,
  selected,
  chapters,
}: {
  folders: FolderSummary[];
  selected: FolderSelection;
  chapters: UserChapter[];
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [chapterId, setChapterId] = useState<string>(
    chapters.length > 0 ? String(chapters[0].chapterId) : "",
  );

  const selectedFolder =
    typeof selected === "number" ? (folders.find((f) => f.id === selected) ?? null) : null;

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      if (chapters.length > 1) form.append("chapterId", chapterId);
      const res = await fetch("/api/folders", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.text()) || "Could not create the folder.");
      setName("");
      setCreating(false);
      navigate(".", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FolderChip to="/" active={selected === "all"}>
          All
        </FolderChip>
        <FolderChip to="/?folder=unfiled" active={selected === "unfiled"}>
          Unfiled
        </FolderChip>
        {folders.map((folder) => (
          <FolderChip key={folder.id} to={`/?folder=${folder.id}`} active={selected === folder.id}>
            {folder.name}
            <span className="text-muted-foreground">{folder.imageCount}</span>
          </FolderChip>
        ))}
        {creating ? null : (
          <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
            <FolderPlus className="size-4" />
            New folder
          </Button>
        )}
      </div>

      {creating ? (
        <form onSubmit={createFolder} className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            placeholder="Folder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-48"
            maxLength={48}
          />
          {chapters.length > 1 ? (
            <Select value={chapterId} onValueChange={setChapterId}>
              <SelectTrigger size="sm">
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
          ) : null}
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Create"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setCreating(false);
              setError(null);
            }}
          >
            <X className="size-4" />
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {selectedFolder ? <FolderActions folder={selectedFolder} /> : null}
    </div>
  );
}

function FolderChip({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-ring hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function FolderActions({ folder }: { folder: FolderSummary }) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", trimmed);
      const res = await fetch(`/api/folders/${folder.id}`, { method: "PATCH", body: form });
      if (!res.ok) throw new Error((await res.text()) || "Could not rename the folder.");
      setRenaming(false);
      navigate(".", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder() {
    if (
      !confirm(
        folder.imageCount > 0
          ? `Delete "${folder.name}"? Its ${folder.imageCount} image(s) will become unfiled.`
          : `Delete "${folder.name}"?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders/${folder.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.text()) || "Could not delete the folder.");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
      {renaming ? (
        <form onSubmit={rename} className="flex items-center gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-48"
            maxLength={48}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">
            {folder.imageCount} image{folder.imageCount === 1 ? "" : "s"} in {folder.name}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
            <Pencil className="size-4" />
            Rename
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={deleteFolder}>
            <Trash2 className="size-4" />
            Delete
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
