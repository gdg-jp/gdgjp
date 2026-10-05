import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  IconButton,
  Icons,
  Input,
  Label,
} from "@gdgjp/design-system";
import { Form, type useFetcher } from "react-router";
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
        <IconButton
          variant="ghost"
          className="absolute top-1/2 right-2 z-10 -translate-y-1/2"
          aria-label={`Actions for ${folder.name}`}
        >
          <Icons name="MoreHorizontal" aria-hidden="true" className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onShare ? (
          <DropdownMenuItem onSelect={onShare}>
            <Icons name="Share2" aria-hidden="true" className="size-4" />
            Share
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onRename}>
          <Icons name="Pencil" aria-hidden="true" className="size-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger" onSelect={onDelete}>
          <Icons name="Trash2" aria-hidden="true" className="size-4" />
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
      <div className="space-y-2">
        <DialogTitle>{folder ? "Rename folder" : "Create folder"}</DialogTitle>
        <DialogDescription>
          {folder
            ? "Update the folder name for everyone who can access it."
            : "Create a folder that you can share with people or chapters."}
        </DialogDescription>
      </div>
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value={folder ? "update" : "create"} />
        {folder ? <input type="hidden" name="id" value={folder.id} /> : null}
        {parentFolderId ? (
          <input type="hidden" name="parentFolderId" value={parentFolderId} />
        ) : null}
        <FormField id="folder-name" label={<>Name</>} required>
          <Input
            id="folder-name"
            name="name"
            defaultValue={folder?.name}
            maxLength={48}
            autoFocus
            required
          />
        </FormField>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" loading={fetcher.state !== "idle"}>
            {folder ? "Rename" : "Create folder"}
          </Button>
        </div>
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
        <div className="space-y-2">
          <AlertDialogTitle>Delete folder?</AlertDialogTitle>
          <AlertDialogDescription>
            Links and child folders in “{target?.name}” will be moved out of this folder. They will
            not be deleted.
          </AlertDialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          <Form method="post" onSubmit={onClose}>
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={target?.id} />
            <AlertDialogAction asChild>
              <Button variant="danger" type="submit">
                Delete folder
              </Button>
            </AlertDialogAction>
          </Form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
