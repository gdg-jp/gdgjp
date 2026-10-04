import { ChevronRight, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, Link, type useFetcher, useNavigation } from "react-router";
import { Badge } from "~/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { SubmitButton } from "~/components/ui/submit-button";
import type { UserChapter } from "~/features/auth/chapter.server";
import type { Folder, FolderPermission } from "~/features/folders/folder-record";
import type { FolderActionData } from "~/features/folders/list.server";

export function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

export function FolderLinksSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading link statistics">
      {[0, 1].map((index) => (
        <Skeleton key={index} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function Breadcrumbs({ folders }: { folders: Folder[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 overflow-hidden text-sm text-muted-foreground"
    >
      <Link to="/folders" className="shrink-0 hover:text-foreground">
        Folders
      </Link>
      {folders.map((folder) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3.5 shrink-0" />
          <Link to={`/folders/${folder.id}`} className="truncate hover:text-foreground">
            {folder.name}
          </Link>
        </span>
      ))}
    </nav>
  );
}

export function FolderActions({
  folder,
  onRename,
  onShare,
  onDelete,
}: { folder: Folder; onRename: () => void; onShare: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={`Actions for ${folder.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onShare}>
          <Share2 className="size-4" />
          Share
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className="size-4" />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CreateFolderForm({
  fetcher,
}: { fetcher: ReturnType<typeof useFetcher<FolderActionData>> }) {
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create folder</DialogTitle>
        <DialogDescription>New folders inherit this folder’s sharing settings.</DialogDescription>
      </DialogHeader>
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="create" />
        <div className="space-y-2">
          <Label htmlFor="child-folder-name">Name</Label>
          <Input id="child-folder-name" name="name" maxLength={48} autoFocus required />
        </div>
        <DialogFooter>
          <SubmitButton pending={fetcher.state !== "idle"} pendingLabel="Creating">
            Create folder
          </SubmitButton>
        </DialogFooter>
      </fetcher.Form>
    </DialogContent>
  );
}

export function RenameFolderForm({
  fetcher,
  folder,
}: { fetcher: ReturnType<typeof useFetcher<FolderActionData>>; folder: Folder }) {
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Rename folder</DialogTitle>
        <DialogDescription>
          Update the folder name for everyone who can access it.
        </DialogDescription>
      </DialogHeader>
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="rename" />
        <div className="space-y-2">
          <Label htmlFor="folder-name">Name</Label>
          <Input
            id="folder-name"
            name="name"
            defaultValue={folder.name}
            maxLength={48}
            autoFocus
            required
          />
        </div>
        <DialogFooter>
          <SubmitButton pending={fetcher.state !== "idle"} pendingLabel="Renaming">
            Rename
          </SubmitButton>
        </DialogFooter>
      </fetcher.Form>
    </DialogContent>
  );
}

export function ShareFolderDialog({
  folder,
  permissions,
  chapters,
  editable,
}: {
  folder: Folder;
  permissions: FolderPermission[];
  chapters: UserChapter[];
  editable: boolean;
}) {
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Share “{folder.name}”</DialogTitle>
        <DialogDescription>
          New links and folders created here start with these permissions.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="rounded-md border">
          {permissions.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Not shared with anyone.</p>
          ) : (
            <div className="px-3">
              {permissions.map((permission) => (
                <FolderPermissionRow
                  key={permission.id}
                  permission={permission}
                  chapters={chapters}
                  editable={editable}
                />
              ))}
            </div>
          )}
        </div>
        {editable ? <ShareForm chapters={chapters} /> : null}
      </div>
    </DialogContent>
  );
}

export function FolderPermissionRow({
  permission,
  chapters,
  editable,
}: { permission: FolderPermission; chapters: UserChapter[]; editable: boolean }) {
  const navigation = useNavigation();
  const active = navigation.formData?.get("permissionId") === String(permission.id);
  const label =
    permission.principalType === "chapter"
      ? (chapters.find((chapter) => String(chapter.chapterId) === permission.principalId)
          ?.chapterSlug ?? `Chapter #${permission.principalId}`)
      : permission.principalId;
  return (
    <div className="flex items-center gap-3 border-b py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {permission.principalType === "chapter" ? "Chapter" : "Email"}
        </p>
      </div>
      {editable ? (
        <>
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="updatePermissionRole" />
            <input type="hidden" name="permissionId" value={permission.id} />
            <Select name="role" defaultValue={permission.role}>
              <SelectTrigger size="sm" className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <SubmitButton
              variant="ghost"
              size="sm"
              pending={active && navigation.formData?.get("intent") === "updatePermissionRole"}
              pendingLabel="Saving"
            >
              Save
            </SubmitButton>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="removePermission" />
            <input type="hidden" name="permissionId" value={permission.id} />
            <SubmitButton
              variant="ghost"
              size="icon-sm"
              aria-label="Remove"
              pending={active && navigation.formData?.get("intent") === "removePermission"}
              pendingLabel="Removing"
            >
              <Trash2 className="size-4 text-destructive" />
            </SubmitButton>
          </Form>
        </>
      ) : (
        <Badge variant="secondary">{permission.role}</Badge>
      )}
    </div>
  );
}

export function ShareForm({ chapters }: { chapters: UserChapter[] }) {
  const navigation = useNavigation();
  const [principalType, setPrincipalType] = useState<"user" | "chapter">("chapter");
  const [chapterId, setChapterId] = useState(chapters[0] ? String(chapters[0].chapterId) : "");
  const [email, setEmail] = useState("");
  const pending =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "addPermission";
  return (
    <Form
      method="post"
      className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-[120px_minmax(0,1fr)_108px_auto]"
    >
      <input type="hidden" name="intent" value="addPermission" />
      <input type="hidden" name="principalType" value={principalType} />
      <Select
        value={principalType}
        onValueChange={(value) => setPrincipalType(value as "user" | "chapter")}
      >
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="user">Email</SelectItem>
          <SelectItem value="chapter" disabled={chapters.length === 0}>
            Chapter
          </SelectItem>
        </SelectContent>
      </Select>
      {principalType === "user" ? (
        <Input
          type="email"
          name="principalId"
          placeholder="alice@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      ) : (
        <>
          <input type="hidden" name="principalId" value={chapterId} />
          <Select value={chapterId} onValueChange={setChapterId}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Choose chapter" />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((chapter) => (
                <SelectItem key={chapter.chapterId} value={String(chapter.chapterId)}>
                  {chapter.chapterSlug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      <Select name="role" defaultValue="viewer">
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="viewer">Viewer</SelectItem>
          <SelectItem value="editor">Editor</SelectItem>
        </SelectContent>
      </Select>
      <SubmitButton
        size="sm"
        pending={pending}
        pendingLabel="Sharing"
        disabled={principalType === "user" ? !email.trim() : !chapterId}
      >
        Share
      </SubmitButton>
    </Form>
  );
}
