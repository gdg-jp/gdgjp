import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  IconButton,
  Icons,
  Inline,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gdgjp/design-system";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

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
            <span>{folder.imageCount}</span>
          </FolderChip>
        ))}
        {creating ? null : (
          <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
            <Icons name="FolderPlus" size={16} aria-hidden="true" className="size-4" />
            New folder
          </Button>
        )}
      </div>

      {creating ? (
        <form onSubmit={createFolder} className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            aria-label="Folder name"
            placeholder="Folder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-48"
            maxLength={48}
          />
          {chapters.length > 1 ? (
            <Select value={chapterId} onValueChange={setChapterId}>
              <SelectTrigger aria-label="Chapter">
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
          <Button type="submit" size="sm" loading={busy} disabled={!name.trim()}>
            Create
          </Button>
          <IconButton
            type="button"
            variant="ghost"
            aria-label="Cancel creating folder"
            onClick={() => {
              setCreating(false);
              setError(null);
            }}
          >
            <Icons name="X" size={16} aria-hidden="true" className="size-4" />
          </IconButton>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
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
    <Button asChild variant={active ? "secondary" : "ghost"} size="sm">
      <Link
        to={to}
        prefetch="intent"
        aria-current={active ? "page" : undefined}
        className="max-w-full whitespace-normal break-words"
      >
        {children}
      </Link>
    </Button>
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
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-surface/20 px-3 py-2">
      {renaming ? (
        <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            aria-label="Folder name"
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
          <span className="text-sm text-muted">
            {folder.imageCount} image{folder.imageCount === 1 ? "" : "s"} in {folder.name}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
            <Icons name="Pencil" size={16} aria-hidden="true" className="size-4" />
            Rename
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={busy}>
                <Icons name="Trash2" size={16} aria-hidden="true" className="size-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Delete “{folder.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {folder.imageCount > 0
                  ? `Its ${folder.imageCount} image(s) will become unfiled.`
                  : "The folder will be removed."}
              </AlertDialogDescription>
              <Inline className="justify-end">
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="danger" onClick={deleteFolder}>
                    Delete folder
                  </Button>
                </AlertDialogAction>
              </Inline>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
