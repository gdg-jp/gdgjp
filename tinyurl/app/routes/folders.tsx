import { type AuthUser, isSuperAdmin } from "@gdgjp/gdg-lib";
import { Folder, MoreHorizontal, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SubmitButton } from "~/components/ui/submit-button";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  type FolderWithCounts,
  canEditFolder,
  createFolder,
  deleteFolder,
  listAccessibleRootFoldersWithCounts,
  updateFolder,
} from "~/lib/db";
import type { Route } from "./+types/folders";

export function meta() {
  return [{ title: "Folders — GDG Japan Links" }];
}

export type FolderActionData = { ok: true; message?: string } | { error: string };

export function folderViewer(user: AuthUser, chapters: { chapterId: number }[]) {
  return {
    userId: user.id,
    email: user.email,
    chapterIds: chapters.map((chapter) => chapter.chapterId),
    isSuperAdmin: isSuperAdmin(user),
  };
}

async function requireContext(args: Route.LoaderArgs | Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  return { env, user, chapter, chapters, viewer: folderViewer(user, chapters) };
}

function folderName(form: FormData): string | null {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return null;
  return name.length <= 48 ? name : null;
}

export async function loader(args: Route.LoaderArgs) {
  const { env, user, chapters, viewer } = await requireContext(args);
  const folders = await listAccessibleRootFoldersWithCounts(env.DB, viewer);
  const editable = await Promise.all(
    folders.map((folder) => canEditFolder(env.DB, folder.id, viewer)),
  );
  return {
    user: { email: user.email, image: user.image, name: user.name },
    folders: folders.map((folder, index) => ({ ...folder, editable: editable[index] })),
    chapters,
  };
}

export async function action(args: Route.ActionArgs): Promise<FolderActionData> {
  const { env, viewer } = await requireContext(args);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = Number(form.get("id"));

  if (intent === "create") {
    const name = folderName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const parentFolderId = Number(form.get("parentFolderId"));
    const result = await createFolder(env.DB, {
      name,
      actor: viewer,
      ...(Number.isInteger(parentFolderId) && parentFolderId > 0 ? { parentFolderId } : {}),
    });
    return result.ok
      ? { ok: true, message: "Folder created." }
      : { error: `Folder \"${name}\" already exists.` };
  }

  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid folder." };
  if (intent === "update") {
    const name = folderName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const result = await updateFolder(env.DB, { id, name, actor: viewer });
    if (result.ok) return { ok: true, message: "Folder renamed." };
    return {
      error:
        result.reason === "duplicate" ? `Folder \"${name}\" already exists.` : "Folder not found.",
    };
  }
  if (intent === "delete") {
    return (await deleteFolder(env.DB, { id, actor: viewer }))
      ? { ok: true, message: "Folder deleted." }
      : { error: "You do not have permission to delete this folder." };
  }
  return { error: "Unknown action." };
}

export default function Folders({ loaderData }: Route.ComponentProps) {
  const { user, folders } = loaderData;
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<(typeof folders)[number] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(typeof folders)[number] | null>(null);
  const fetcher = useFetcher<FolderActionData>();
  const handledData = useRef<FolderActionData | undefined>(undefined);

  useEffect(() => {
    if (!fetcher.data || fetcher.data === handledData.current) return;
    handledData.current = fetcher.data;
    if ("error" in fetcher.data) toast.error(fetcher.data.error);
    else {
      toast.success(fetcher.data.message ?? "Saved.");
      setCreateOpen(false);
      setEditTarget(null);
    }
  }, [fetcher.data]);

  return (
    <DashboardShell user={user}>
      <DashboardPage>
        <DashboardPageHeader
          title="Folders"
          description="Organize links and share folders with people or chapters."
          actions={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4" />
                  Create folder
                </Button>
              </DialogTrigger>
              <FolderForm fetcher={fetcher} />
            </Dialog>
          }
        />

        {folders.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/15 px-6 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Folder className="size-5" />
            </span>
            <h2 className="text-sm font-semibold">No folders yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Create a folder to collect links and share them with your collaborators.
            </p>
          </div>
        ) : (
          <section aria-label="Folders">
            <p className="mb-3 text-sm font-medium text-muted-foreground">Name</p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {folders.map((folder) => (
                <li key={folder.id} className="relative min-w-0">
                  <Link
                    to={`/folders/${folder.id}`}
                    prefetch="intent"
                    className="group flex min-h-20 items-center gap-3 rounded-xl border bg-muted/35 px-4 py-3 pr-12 transition-colors hover:bg-muted/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-600 dark:text-amber-400">
                      <Folder className="size-5 fill-current" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{folder.name}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        {folder.linkCount} {folder.linkCount === 1 ? "link" : "links"}
                      </span>
                    </span>
                  </Link>
                  {folder.editable ? (
                    <FolderMenu
                      folder={folder}
                      onRename={() => setEditTarget(folder)}
                      onDelete={() => setDeleteTarget(folder)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
          {editTarget ? <FolderForm fetcher={fetcher} folder={editTarget} /> : null}
        </Dialog>
        <DeleteFolderDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
      </DashboardPage>
    </DashboardShell>
  );
}

export function FolderMenu({
  folder,
  onRename,
  onDelete,
  onShare,
}: {
  folder: Pick<FolderWithCounts, "id" | "name">;
  onRename: () => void;
  onDelete: () => void;
  onShare?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-2 z-10 -translate-y-1/2"
          aria-label={`Actions for ${folder.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onShare ? (
          <DropdownMenuItem onSelect={onShare}>
            <Share2 className="size-4" />
            Share
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="size-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className="size-4" />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FolderForm({
  fetcher,
  folder,
  parentFolderId,
}: {
  fetcher: ReturnType<typeof useFetcher<FolderActionData>>;
  folder?: Pick<FolderWithCounts, "id" | "name">;
  parentFolderId?: number;
}) {
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{folder ? "Rename folder" : "Create folder"}</DialogTitle>
        <DialogDescription>
          {folder
            ? "Update the folder name for everyone who can access it."
            : "Create a folder that you can share with people or chapters."}
        </DialogDescription>
      </DialogHeader>
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value={folder ? "update" : "create"} />
        {folder ? <input type="hidden" name="id" value={folder.id} /> : null}
        {parentFolderId ? (
          <input type="hidden" name="parentFolderId" value={parentFolderId} />
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="folder-name">Name</Label>
          <Input
            id="folder-name"
            name="name"
            defaultValue={folder?.name}
            maxLength={48}
            autoFocus
            required
          />
        </div>
        <DialogFooter>
          <SubmitButton
            pending={fetcher.state !== "idle"}
            pendingLabel={folder ? "Renaming" : "Creating"}
          >
            {folder ? "Rename" : "Create folder"}
          </SubmitButton>
        </DialogFooter>
      </fetcher.Form>
    </DialogContent>
  );
}

export function DeleteFolderDialog({
  target,
  onClose,
}: {
  target: Pick<FolderWithCounts, "id" | "name"> | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder?</AlertDialogTitle>
          <AlertDialogDescription>
            Links and child folders in “{target?.name}” will be moved out of this folder. They will
            not be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Form method="post" onSubmit={onClose}>
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={target?.id} />
            <AlertDialogAction type="submit">Delete folder</AlertDialogAction>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
