import {
  ChevronRight,
  Folder as FolderIcon,
  Link as LinkIcon,
  MoreHorizontal,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Await, Form, Link, redirect, useFetcher, useNavigation } from "react-router";
import { toast } from "sonner";
import { CreateLinkDialog } from "~/components/create-link-dialog";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import type { LinkCardItem } from "~/components/link-card";
import { LinkList } from "~/components/link-list";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
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
import { clicksByLinkId } from "~/lib/analytics-engine";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import type { UserChapter } from "~/lib/chapter.server";
import {
  type Folder,
  type FolderPermission,
  addFolderPermission,
  canEditFolder,
  createFolder,
  deleteFolder,
  getAccessibleFolder,
  getUsersByIds,
  listAccessibleChildFoldersWithCounts,
  listAllAccessibleFolders,
  listFolderPermissions,
  listLinksInFolderAccessible,
  listTagsForChapter,
  listTagsForLinks,
  listTagsForUser,
  removeFolderPermission,
  updateFolder,
  updateFolderPermissionRole,
} from "~/lib/db";
import {
  BUILT_IN_DISPLAY_DEFAULTS,
  type DisplayPreferences,
  readDisplayPreferences,
} from "~/lib/display-preferences";
import { listDomainsForChapters } from "~/lib/domains";
import type { Route } from "./+types/folders.$id";
import { DeleteFolderDialog, type FolderActionData, folderViewer } from "./folders";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.folder.name ?? "Folder"} — GDG Japan Links` }];
}

function validName(form: FormData): string | null {
  const name = String(form.get("name") ?? "").trim();
  return name && name.length <= 48 ? name : null;
}

async function requireContext(args: Route.LoaderArgs | Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const id = Number(args.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new Response("Not found", { status: 404 });
  return { env, user, chapter, chapters, id, viewer: folderViewer(user, chapters) };
}

function breadcrumbsFor(folder: Folder, accessibleFolders: Folder[]): Folder[] {
  const byId = new Map(accessibleFolders.map((item) => [item.id, item]));
  const result = [folder];
  const seen = new Set([folder.id]);
  let cursor = folder;
  while (cursor.parentFolderId !== null) {
    const parent = byId.get(cursor.parentFolderId);
    if (!parent || seen.has(parent.id)) break;
    result.unshift(parent);
    seen.add(parent.id);
    cursor = parent;
  }
  return result;
}

export async function loader(args: Route.LoaderArgs) {
  const { env, user, chapters, id, viewer } = await requireContext(args);
  const folder = await getAccessibleFolder(env.DB, id, viewer);
  if (!folder) throw new Response("Not found", { status: 404 });
  const [childFolders, links, allFolders, editable, permissions, userTags, chapterTags, domains] =
    await Promise.all([
      listAccessibleChildFoldersWithCounts(env.DB, id, viewer),
      listLinksInFolderAccessible(env.DB, { ...viewer, folderId: id, includeArchived: true }),
      listAllAccessibleFolders(env.DB, viewer),
      canEditFolder(env.DB, id, viewer),
      listFolderPermissions(env.DB, id),
      listTagsForUser(env.DB, user.id),
      Promise.all(chapters.map((chapter) => listTagsForChapter(env.DB, chapter.chapterId))),
      listDomainsForChapters(
        env.DB,
        chapters.map((chapter) => chapter.chapterId),
      ),
    ]);
  const linkIds = links.map((link) => link.id);
  const clicks = clicksByLinkId(env, linkIds)
    .then((clickMap) => Object.fromEntries(clickMap))
    .catch((error) => {
      console.error("Analytics Engine query failed (folder links):", error);
      return {} as Record<string, number>;
    });
  const [owners, tagsByLinkId] = await Promise.all([
    getUsersByIds(env.DB, [...new Set(links.map((link) => link.ownerUserId))]),
    listTagsForLinks(env.DB, linkIds),
  ]);
  return {
    user: { email: user.email, image: user.image, name: user.name },
    folder,
    breadcrumbs: breadcrumbsFor(folder, allFolders),
    childFolders,
    links,
    owners,
    tagsByLinkId,
    clicks,
    editable,
    permissions,
    chapters,
    availableTags: [...userTags, ...chapterTags.flat()],
    domainOptions: domains
      .filter((domain) => domain.status === "active")
      .map((domain) => ({ id: domain.id, hostname: domain.hostname })),
    shortUrlBase: env.SHORT_URL_BASE,
  };
}

export async function action(args: Route.ActionArgs): Promise<FolderActionData> {
  const { env, viewer, id } = await requireContext(args);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = validName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const result = await createFolder(env.DB, { name, actor: viewer, parentFolderId: id });
    return result.ok
      ? { ok: true, message: "Folder created." }
      : { error: "Could not create folder." };
  }
  if (intent === "rename") {
    const name = validName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const result = await updateFolder(env.DB, { id, name, actor: viewer });
    return result.ok
      ? { ok: true, message: "Folder renamed." }
      : { error: "Could not rename folder." };
  }
  if (intent === "delete") {
    if (!(await deleteFolder(env.DB, { id, actor: viewer })))
      return { error: "Could not delete folder." };
    throw redirect("/folders");
  }
  if (intent === "addPermission") {
    const principalType = String(form.get("principalType"));
    const principalId = String(form.get("principalId") ?? "").trim();
    const role = String(form.get("role"));
    if ((principalType !== "user" && principalType !== "chapter") || !principalId) {
      return { error: "Choose a person or chapter to share with." };
    }
    if (principalType === "user" && !principalId.includes("@"))
      return { error: "Enter a valid email." };
    if (role !== "editor" && role !== "viewer") return { error: "Choose a valid permission." };
    const result = await addFolderPermission(env.DB, {
      ...viewer,
      folderId: id,
      principalType,
      principalId,
      role,
    });
    return result.ok
      ? { ok: true, message: "Folder shared." }
      : { error: "Could not update sharing." };
  }
  const permissionId = Number(form.get("permissionId"));
  if (!Number.isInteger(permissionId) || permissionId <= 0) return { error: "Invalid permission." };
  if (intent === "removePermission") {
    return (await removeFolderPermission(env.DB, { ...viewer, folderId: id, id: permissionId }))
      ? { ok: true, message: "Sharing removed." }
      : { error: "Could not remove sharing." };
  }
  if (intent === "updatePermissionRole") {
    const role = String(form.get("role"));
    if (role !== "editor" && role !== "viewer") return { error: "Choose a valid permission." };
    return (await updateFolderPermissionRole(env.DB, {
      ...viewer,
      folderId: id,
      id: permissionId,
      role,
    }))
      ? { ok: true, message: "Permission updated." }
      : { error: "Could not update sharing." };
  }
  return { error: "Unknown action." };
}

export default function FolderDetail({ loaderData }: Route.ComponentProps) {
  const {
    user,
    folder,
    breadcrumbs,
    childFolders,
    links,
    owners,
    tagsByLinkId,
    editable,
    permissions,
    chapters,
    availableTags,
    domainOptions,
    shortUrlBase,
  } = loaderData;
  const shortHost = shortHostOf(shortUrlBase);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [displayPreferences, setDisplayPreferences] = useState<DisplayPreferences>({
    ...BUILT_IN_DISPLAY_DEFAULTS,
    properties: [...BUILT_IN_DISPLAY_DEFAULTS.properties],
  });
  const fetcher = useFetcher<FolderActionData>();
  const handled = useRef<FolderActionData | undefined>(undefined);
  useEffect(() => {
    if (!fetcher.data || fetcher.data === handled.current) return;
    handled.current = fetcher.data;
    if ("error" in fetcher.data) toast.error(fetcher.data.error);
    else {
      toast.success(fetcher.data.message ?? "Saved.");
      setCreateOpen(false);
      setRenameOpen(false);
    }
  }, [fetcher.data]);
  useEffect(() => {
    try {
      const preferences = readDisplayPreferences(window.localStorage);
      setDisplayPreferences({ ...preferences, properties: [...preferences.properties] });
    } catch {
      // Invalid or unavailable storage falls back to the built-in display defaults.
    }
  }, []);

  const displayedLinks = displayPreferences.showArchived
    ? links
    : links.filter((link) => link.archivedAt === null);

  return (
    <DashboardShell user={user}>
      <DashboardPage>
        <DashboardPageHeader
          title={folder.name}
          eyebrow={<Breadcrumbs folders={breadcrumbs} />}
          actions={
            editable ? (
              <>
                <CreateLinkDialog
                  availableTags={availableTags}
                  chapters={chapters}
                  defaultFolderId={folder.id}
                  domainOptions={domainOptions}
                  shortUrlBase={shortUrlBase}
                  trigger={
                    <Button size="sm">
                      <LinkIcon className="size-4" />
                      Create link
                    </Button>
                  }
                />
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  Create folder
                </Button>
                <FolderActions
                  folder={folder}
                  onRename={() => setRenameOpen(true)}
                  onShare={() => setShareOpen(true)}
                  onDelete={() => setDeleteOpen(true)}
                />
              </>
            ) : null
          }
        />

        {childFolders.length === 0 && displayedLinks.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/15 px-6 text-center">
            <FolderIcon className="mb-3 size-8 text-muted-foreground" />
            <h2 className="text-sm font-semibold">This folder is empty</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {editable
                ? "Create a link or folder to start organizing this space."
                : "There are no visible items in this folder."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {childFolders.length > 0 ? (
              <section aria-labelledby="child-folders-heading">
                <h2
                  id="child-folders-heading"
                  className="mb-3 text-sm font-medium text-muted-foreground"
                >
                  Folders
                </h2>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {childFolders.map((child) => (
                    <li key={child.id}>
                      <Link
                        to={`/folders/${child.id}`}
                        prefetch="intent"
                        className="flex min-h-20 items-center gap-3 rounded-xl border bg-muted/35 px-4 py-3 transition-colors hover:bg-muted/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-600 dark:text-amber-400">
                          <FolderIcon className="size-5 fill-current" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{child.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {child.childFolderCount}{" "}
                            {child.childFolderCount === 1 ? "folder" : "folders"} ·{" "}
                            {child.linkCount} {child.linkCount === 1 ? "link" : "links"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {displayedLinks.length > 0 ? (
              <section aria-labelledby="folder-links-heading">
                <h2
                  id="folder-links-heading"
                  className="mb-3 text-sm font-medium text-muted-foreground"
                >
                  Links
                </h2>
                <Suspense fallback={<FolderLinksSkeleton />}>
                  <Await resolve={loaderData.clicks}>
                    {(clicks) => (
                      <LinkList
                        items={displayedLinks
                          .map<LinkCardItem>((link) => ({
                            link,
                            owner: owners[link.ownerUserId],
                            clicks: clicks[link.id] ?? 0,
                            tags: tagsByLinkId[link.id] ?? [],
                            folder,
                          }))
                          .sort((left, right) => {
                            if (displayPreferences.sort === "oldest") {
                              return left.link.createdAt - right.link.createdAt;
                            }
                            if (displayPreferences.sort === "mostClicks") {
                              return right.clicks - left.clicks;
                            }
                            return right.link.createdAt - left.link.createdAt;
                          })}
                        shortUrlBase={shortUrlBase}
                        shortHost={shortHost}
                        layout={displayPreferences.layout}
                        properties={displayPreferences.properties}
                      />
                    )}
                  </Await>
                </Suspense>
              </section>
            ) : null}
          </div>
        )}

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <CreateFolderForm fetcher={fetcher} />
        </Dialog>
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <RenameFolderForm fetcher={fetcher} folder={folder} />
        </Dialog>
        <Dialog open={shareOpen} onOpenChange={setShareOpen}>
          <ShareFolderDialog
            folder={folder}
            permissions={permissions}
            chapters={chapters}
            editable={editable}
          />
        </Dialog>
        <DeleteFolderDialog
          target={deleteOpen ? folder : null}
          onClose={() => setDeleteOpen(false)}
        />
      </DashboardPage>
    </DashboardShell>
  );
}

function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

function FolderLinksSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading link statistics">
      {[0, 1].map((index) => (
        <Skeleton key={index} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

function Breadcrumbs({ folders }: { folders: Folder[] }) {
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

function FolderActions({
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

function CreateFolderForm({
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

function RenameFolderForm({
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

function ShareFolderDialog({
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

function FolderPermissionRow({
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

function ShareForm({ chapters }: { chapters: UserChapter[] }) {
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
