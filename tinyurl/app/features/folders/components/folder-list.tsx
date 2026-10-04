import { MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { Form, type useFetcher } from "react-router";
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { FolderWithCounts } from "~/features/folders/folder-record";
import type { FolderActionData } from "~/features/folders/list.server";

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
