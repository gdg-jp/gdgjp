import {
  BarChart3,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder as FolderIcon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "~/components/dashboard-shell";
import { TagCombobox } from "~/components/tag-combobox";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { Textarea } from "~/components/ui/textarea";
import { clicksByLinkId } from "~/lib/analytics-engine";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import type { UserChapter } from "~/lib/chapter.server";
import {
  type LinkPermission,
  type LinkVisibility,
  type UserSummary,
  addComment,
  addPermission,
  createTag,
  deleteComment,
  getLinkById,
  getUsersByIds,
  listComments,
  listPermissionsForLink,
  listTagsForChapter,
  listTagsForLink,
  listTagsForUser,
  removePermission,
  setLinkTags,
  softDeleteLink,
  updateLink,
  updatePermissionRole,
} from "~/lib/db";
import { isLinkId } from "~/lib/id";
import { fetchOgp } from "~/lib/ogp";
import { type ViewerContext, canEditLink, canViewLink } from "~/lib/permissions";
import { validateSlug } from "~/lib/slug";
import type { Route } from "./+types/links.$id";

async function ensureAccess(args: Route.LoaderArgs | Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const id = String(args.params.id ?? "");
  if (!isLinkId(id)) throw new Response("Not found", { status: 404 });
  const link = await getLinkById(env.DB, id);
  if (!link) throw new Response("Not found", { status: 404 });
  const permissions = await listPermissionsForLink(env.DB, id);
  const ctx: ViewerContext = { user, chapterId: chapter.chapterId };
  if (!canViewLink(ctx, link, permissions)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const editable = canEditLink(ctx, link, permissions);
  return { env, user, chapter, chapters, link, permissions, ctx, editable, id };
}

export async function loader(args: Route.LoaderArgs) {
  const { env, user, chapter, chapters, link, permissions, editable } = await ensureAccess(args);
  const [tags, userTags, chapterTags, comments, clickMap] = await Promise.all([
    listTagsForLink(env.DB, link.id),
    listTagsForUser(env.DB, user.id),
    listTagsForChapter(env.DB, chapter.chapterId),
    listComments(env.DB, link.id),
    clicksByLinkId(env, [link.id]).catch(() => new Map<string, number>()),
  ]);
  const users = await getUsersByIds(env.DB, [link.ownerUserId]);
  const latestComment = comments.length > 0 ? comments[comments.length - 1] : null;
  const chapterNameById: Record<string, string> = {};
  for (const c of chapters) chapterNameById[String(c.chapterId)] = c.chapterSlug;
  return {
    user: { email: user.email, name: user.name },
    link,
    permissions,
    tags,
    availableTags: [...userTags, ...chapterTags],
    comment: latestComment?.body ?? "",
    users,
    editable,
    chapters,
    chapterNameById,
    appUrl: env.APP_URL,
    shortUrlBase: env.SHORT_URL_BASE,
    clicks: clickMap.get(link.id) ?? 0,
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.link.slug ?? "Link"} — GDG Japan Links` }];
}

export async function action(args: Route.ActionArgs) {
  const { env, user, link, editable, id } = await ensureAccess(args);
  const form = await args.request.formData();
  const intent = form.get("intent");

  if (!editable) return { error: "You don't have permission to edit this link." };

  if (intent === "delete") {
    await softDeleteLink(env.DB, id);
    throw redirect("/links");
  }

  if (intent === "update") {
    const update: Parameters<typeof updateLink>[2] = {};

    if (form.has("destinationUrl")) {
      const destinationUrl = String(form.get("destinationUrl") ?? "").trim();
      if (!destinationUrl) return { error: "Destination URL is required." };
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(destinationUrl);
      } catch {
        return { error: "Destination URL is not a valid URL." };
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { error: "Destination URL must use http or https." };
      }
      update.destinationUrl = destinationUrl;
    }

    if (form.has("slug")) {
      const slug = String(form.get("slug") ?? "").trim();
      if (!slug) return { error: "Slug is required." };
      const validation = validateSlug(slug);
      if (!validation.ok) {
        return {
          error:
            validation.reason === "reserved"
              ? `"${slug}" is a reserved slug.`
              : "Slug may only contain letters, numbers, hyphens, and underscores (1–64 chars).",
        };
      }
      update.slug = slug;
    }

    if (form.has("title")) {
      update.title = String(form.get("title") ?? "").trim() || null;
    }
    if (form.has("description")) {
      update.description = String(form.get("description") ?? "").trim() || null;
    }
    if (form.has("ogImageUrl")) {
      update.ogImageUrl = String(form.get("ogImageUrl") ?? "").trim() || null;
    }
    if (form.has("visibility")) {
      const v = String(form.get("visibility") ?? "");
      if (v !== "private" && v !== "public") {
        return { error: "Visibility must be private or public." };
      }
      update.visibility = v;
    }

    try {
      await updateLink(env.DB, id, update);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) {
        return { error: `The slug "${update.slug}" is already taken.` };
      }
      throw err;
    }

    if (form.has("manageTags")) {
      const existingIds = form
        .getAll("tagId")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0);
      const newNames = form
        .getAll("newTagName")
        .map((v) => String(v).trim())
        .filter((n) => n.length > 0 && n.length <= 32);

      const finalIds = new Set(await listAllowedTagIds(env.DB, user.id, existingIds));
      for (const name of newNames) {
        const result = await createTag(env.DB, { name, color: null, ownerUserId: user.id });
        if (result.ok) {
          finalIds.add(result.tag.id);
        } else {
          const row = await env.DB.prepare(
            "SELECT id FROM tags WHERE name = ? AND (owner_user_id = ? OR owner_user_id IS NULL)",
          )
            .bind(name, user.id)
            .first<{ id: number }>();
          if (row?.id) finalIds.add(row.id);
        }
      }
      await setLinkTags(env.DB, id, [...finalIds]);
    }

    if (form.has("comment")) {
      const body = String(form.get("comment") ?? "").trim();
      if (body.length > 2000) return { error: "Comment is too long (max 2000 chars)." };
      const existing = await listComments(env.DB, id);
      for (const c of existing.filter((c) => c.authorUserId === user.id))
        await deleteComment(env.DB, c.id);
      if (body) {
        await addComment(env.DB, { linkId: id, authorUserId: user.id, body });
      }
    }

    return { success: "Saved." };
  }

  if (intent === "fetchOgp") {
    const destinationUrl = String(form.get("destinationUrl") ?? link.destinationUrl).trim();
    const ogp = await fetchOgp(destinationUrl || link.destinationUrl);
    if (!ogp) return { error: "Could not fetch OGP data for that URL." };
    await updateLink(env.DB, id, {
      title: ogp.title ?? link.title,
      description: ogp.description ?? link.description,
      ogImageUrl: ogp.image ?? link.ogImageUrl,
    });
    return { success: "OGP data fetched." };
  }

  if (intent === "addPermission") {
    const principalType = String(form.get("principalType") ?? "");
    const principalId = String(form.get("principalId") ?? "").trim();
    const role = String(form.get("role") ?? "");
    if (principalType !== "user" && principalType !== "chapter") {
      return { error: "Invalid principal type." };
    }
    if (role !== "editor" && role !== "viewer") return { error: "Invalid role." };
    if (!principalId) return { error: "Principal id required." };
    if (principalType === "user" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(principalId)) {
      return { error: "Invalid email address." };
    }
    if (principalType === "chapter" && !/^\d+$/.test(principalId)) {
      return { error: "Chapter id must be a number." };
    }
    const result = await addPermission(env.DB, {
      linkId: id,
      principalType,
      principalId,
      role,
    });
    if (!result.ok) return { error: "That principal already has access to this link." };
    return { success: "Permission added." };
  }

  if (intent === "removePermission") {
    const permId = Number(form.get("permissionId"));
    if (!Number.isInteger(permId) || permId <= 0) return { error: "Invalid permission id." };
    const removed = await removePermission(env.DB, id, permId);
    if (!removed) return { error: "Permission not found for this link." };
    return null;
  }

  if (intent === "updatePermissionRole") {
    const permId = Number(form.get("permissionId"));
    const role = String(form.get("role") ?? "");
    if (!Number.isInteger(permId) || permId <= 0) return { error: "Invalid permission id." };
    if (role !== "editor" && role !== "viewer") return { error: "Invalid role." };
    const updated = await updatePermissionRole(env.DB, id, permId, role);
    if (!updated) return { error: "Permission not found for this link." };
    return null;
  }

  return { error: "Unknown action." };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateShort(unix: number): string {
  const d = new Date(unix * 1000);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear()
    ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function userInitials(users: Record<string, UserSummary>, id: string): string {
  const u = users[id];
  const source = u?.name || u?.email || id;
  const parts = source.split(/\s+|@/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

function faviconUrl(url: string): string | null {
  const host = hostnameOf(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

async function listAllowedTagIds(
  db: D1Database,
  userId: string,
  tagIds: number[],
): Promise<number[]> {
  const ids = [...new Set(tagIds)];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT id FROM tags
       WHERE id IN (${placeholders})
         AND (owner_user_id = ? OR owner_user_id IS NULL)`,
    )
    .bind(...ids, userId)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </Label>
  );
}

function PermissionRow({
  permission,
  editable,
  chapterNameById,
}: {
  permission: LinkPermission;
  editable: boolean;
  chapterNameById: Record<string, string>;
}) {
  const label =
    permission.principalType === "chapter"
      ? (chapterNameById[permission.principalId] ?? `Chapter #${permission.principalId}`)
      : permission.principalId;
  const principalLabel = permission.principalType === "chapter" ? "Chapter" : "Email";
  return (
    <div className="flex items-center gap-3 border-b py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{principalLabel}</p>
      </div>
      {editable ? (
        <>
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="updatePermissionRole" />
            <input type="hidden" name="permissionId" value={permission.id} />
            <Select name="role" defaultValue={permission.role}>
              <SelectTrigger className="h-8 w-[110px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="ghost" size="sm">
              Save
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="removePermission" />
            <input type="hidden" name="permissionId" value={permission.id} />
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Remove">
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </Form>
        </>
      ) : (
        <Badge variant="secondary">{permission.role}</Badge>
      )}
    </div>
  );
}

type Draft = {
  destinationUrl: string;
  slug: string;
  title: string;
  description: string;
  ogImageUrl: string;
  visibility: LinkVisibility;
  tagIds: number[];
  newTagNames: string[];
  comment: string;
};

function buildInitial(loaderData: Route.ComponentProps["loaderData"]): Draft {
  return {
    destinationUrl: loaderData.link.destinationUrl,
    slug: loaderData.link.slug,
    title: loaderData.link.title ?? "",
    description: loaderData.link.description ?? "",
    ogImageUrl: loaderData.link.ogImageUrl ?? "",
    visibility: loaderData.link.visibility,
    tagIds: loaderData.tags.map((t) => t.id),
    newTagNames: [],
    comment: loaderData.comment,
  };
}

function draftEqual(a: Draft, b: Draft): boolean {
  if (
    a.destinationUrl !== b.destinationUrl ||
    a.slug !== b.slug ||
    a.title !== b.title ||
    a.description !== b.description ||
    a.ogImageUrl !== b.ogImageUrl ||
    a.visibility !== b.visibility ||
    a.comment !== b.comment ||
    a.tagIds.length !== b.tagIds.length ||
    a.newTagNames.length !== b.newTagNames.length
  ) {
    return false;
  }
  const aTagSet = new Set(a.tagIds);
  for (const id of b.tagIds) if (!aTagSet.has(id)) return false;
  for (let i = 0; i < a.newTagNames.length; i++) {
    if (a.newTagNames[i] !== b.newTagNames[i]) return false;
  }
  return true;
}

export default function EditLink({ loaderData, actionData }: Route.ComponentProps) {
  const {
    link,
    availableTags,
    permissions,
    users,
    editable,
    chapters,
    chapterNameById,
    shortUrlBase,
    clicks,
  } = loaderData;
  const apexShortUrl = `${shortUrlBase}/${link.slug}`;
  const shortHost = shortHostOf(shortUrlBase);
  const favicon = faviconUrl(link.destinationUrl);
  const owner = users[link.ownerUserId];

  const initial = useMemo(() => buildInitial(loaderData), [loaderData]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const [slugDialogOpen, setSlugDialogOpen] = useState(false);
  useEffect(() => {
    setDraft(initial);
    setSlugUnlocked(false);
  }, [initial]);

  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  const lastToastedRef = useRef<unknown>(null);
  useEffect(() => {
    if (!actionData || lastToastedRef.current === actionData) return;
    lastToastedRef.current = actionData;
    if ("success" in actionData && actionData.success) {
      toast.success("Successfully updated short link!", { icon: <Check className="size-4" /> });
    } else if ("error" in actionData && actionData.error) {
      toast.error(actionData.error);
    }
  }, [actionData]);

  const isDirty = !draftEqual(draft, initial);

  function discard() {
    setDraft(initial);
    setSlugUnlocked(false);
  }

  function copyShort() {
    navigator.clipboard.writeText(apexShortUrl).then(() => toast.success("Copied to clipboard"));
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <DashboardShell user={loaderData.user}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-24">
        {/* Top bar: breadcrumb + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex min-w-0 items-center gap-2 text-sm" aria-label="Breadcrumb">
            <Link
              to="/links"
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-foreground hover:bg-accent"
            >
              <FolderIcon className="size-4 text-primary" />
              Links
            </Link>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 font-medium">
              {favicon ? (
                <img src={favicon} alt="" width={16} height={16} className="size-4 rounded-sm" />
              ) : (
                <ExternalLink className="size-4 text-muted-foreground" />
              )}
              <span className="truncate">
                {shortHost}/{link.slug}
              </span>
            </span>
          </nav>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={copyShort}>
              <Copy className="size-4" />
              Copy link
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`/analytics?linkId=${link.id}`}>
                <BarChart3 className="size-4 text-primary" />
                {clicks} {clicks === 1 ? "click" : "clicks"}
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Link actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={copyShort}>
                  <Copy className="size-4" />
                  Copy short URL
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={link.destinationUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Visit destination
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={apexShortUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Visit short URL
                  </a>
                </DropdownMenuItem>
                {editable ? (
                  <>
                    <DropdownMenuSeparator />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={(e) => e.preventDefault()}
                        >
                          <Trash2 className="size-4" />
                          Delete link…
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{link.slug}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove the short link.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete" />
                            <AlertDialogAction type="submit" className="bg-destructive">
                              Delete
                            </AlertDialogAction>
                          </Form>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {actionData && "error" in actionData && actionData.error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{actionData.error}</AlertDescription>
          </Alert>
        ) : null}

        {/* Hidden update form — visible inputs reference it via `form="link-update"` */}
        <Form id="link-update" method="post" className="hidden">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="manageTags" value="1" />
          <input type="hidden" name="visibility" value={draft.visibility} />
          {draft.tagIds.map((tagId) => (
            <input key={`tag-${tagId}`} type="hidden" name="tagId" value={tagId} />
          ))}
          {draft.newTagNames.map((name, idx) => (
            <input key={`new-tag-${idx}-${name}`} type="hidden" name="newTagName" value={name} />
          ))}
        </Form>

        {/* Body grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* LEFT COLUMN */}
          <div className="space-y-8 lg:col-span-2">
            {/* Destination URL */}
            <div className="space-y-2">
              <FieldLabel htmlFor="destinationUrl">Destination URL</FieldLabel>
              <Input
                id="destinationUrl"
                form="link-update"
                name="destinationUrl"
                type="url"
                value={draft.destinationUrl}
                onChange={(e) => setField("destinationUrl", e.target.value)}
                required
                disabled={!editable}
              />
            </div>

            {/* Short Link */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="slug">Short Link</FieldLabel>
                {editable ? (
                  <AlertDialog open={slugDialogOpen} onOpenChange={setSlugDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit short link"
                        disabled={slugUnlocked}
                      >
                        <Pencil className="size-3.5 text-muted-foreground" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Edit short link?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Editing an existing short link could potentially break existing links. Are
                          you sure you want to continue?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            setSlugUnlocked(true);
                            setSlugDialogOpen(false);
                          }}
                        >
                          Continue
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>
              <div className="flex gap-2">
                <div className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                  {shortHost}
                </div>
                <Input
                  id="slug"
                  form="link-update"
                  name="slug"
                  value={draft.slug}
                  onChange={(e) => setField("slug", e.target.value)}
                  pattern="[a-zA-Z0-9_\-]{1,64}"
                  required
                  disabled={!editable || !slugUnlocked}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FieldLabel>Tags</FieldLabel>
              </div>
              <TagCombobox
                availableTags={availableTags}
                selectedIds={draft.tagIds}
                newTagNames={draft.newTagNames}
                onChange={(ids, names) =>
                  setDraft((d) => ({ ...d, tagIds: ids, newTagNames: names }))
                }
                disabled={!editable}
              />
            </div>

            {/* Comment (single) */}
            <div className="space-y-2">
              <FieldLabel htmlFor="comment">Comment</FieldLabel>
              <Textarea
                id="comment"
                form="link-update"
                name="comment"
                value={draft.comment}
                onChange={(e) => setField("comment", e.target.value)}
                placeholder="Add a comment"
                maxLength={2000}
                rows={3}
                disabled={!editable}
              />
            </div>

            {/* Visibility */}
            <div className="space-y-2">
              <FieldLabel htmlFor="visibility">Visibility</FieldLabel>
              <Select
                value={draft.visibility}
                onValueChange={(value) => setField("visibility", value as LinkVisibility)}
                disabled={!editable}
              >
                <SelectTrigger id="visibility" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">
                    Private — only you and people you share with
                  </SelectItem>
                  <SelectItem value="public">Anyone in GDG Japan can view</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sharing */}
            <div className="space-y-3">
              <FieldLabel>Sharing</FieldLabel>
              <div className="rounded-md border bg-card">
                {permissions.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">Not shared with anyone.</p>
                ) : (
                  <div className="px-3">
                    {permissions.map((perm) => (
                      <PermissionRow
                        key={perm.id}
                        permission={perm}
                        editable={editable}
                        chapterNameById={chapterNameById}
                      />
                    ))}
                  </div>
                )}
              </div>
              {editable ? <ShareForm chapters={chapters} /> : null}
            </div>

            {/* Created by footer */}
            <div className="flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
              <Avatar size="sm">
                <AvatarFallback>{userInitials(users, link.ownerUserId)}</AvatarFallback>
              </Avatar>
              <span>
                Created by{" "}
                <span className="font-medium text-foreground">
                  {owner ? owner.email || owner.name || link.ownerUserId : link.ownerUserId}
                </span>
                {" · "}
                {formatDateShort(link.createdAt)}
              </span>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-6">
            {/* QR Code */}
            <div className="space-y-2">
              <FieldLabel>QR Code</FieldLabel>
              <div className="flex items-center justify-center rounded-md border bg-card p-4">
                <QRCodeSVG value={apexShortUrl} size={140} />
              </div>
              <p className="break-all text-center font-mono text-xs text-muted-foreground">
                {apexShortUrl}
              </p>
            </div>

            {/* Custom Link Preview */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FieldLabel>Custom Link Preview</FieldLabel>
                {editable ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="fetchOgp" />
                    <input type="hidden" name="destinationUrl" value={draft.destinationUrl} />
                    <Button type="submit" variant="ghost" size="xs">
                      <RefreshCw className="size-3" />
                      Fetch
                    </Button>
                  </Form>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-md border bg-card">
                {draft.ogImageUrl ? (
                  <img
                    src={draft.ogImageUrl}
                    alt="OGP preview"
                    className="aspect-video w-full bg-muted object-cover"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                    Enter a link to generate a preview
                  </div>
                )}
                <div className="space-y-1 px-3 py-2">
                  <p className="truncate text-sm font-medium">
                    {draft.title || hostnameOf(draft.destinationUrl) || "Untitled"}
                  </p>
                  {draft.description ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {draft.description}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="title" className="text-xs text-muted-foreground">
                    Title
                  </Label>
                  <Input
                    id="title"
                    form="link-update"
                    name="title"
                    value={draft.title}
                    onChange={(e) => setField("title", e.target.value)}
                    disabled={!editable}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-xs text-muted-foreground">
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    form="link-update"
                    name="description"
                    value={draft.description}
                    onChange={(e) => setField("description", e.target.value)}
                    disabled={!editable}
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ogImageUrl" className="text-xs text-muted-foreground">
                    Image URL
                  </Label>
                  <Input
                    id="ogImageUrl"
                    form="link-update"
                    name="ogImageUrl"
                    type="url"
                    value={draft.ogImageUrl}
                    onChange={(e) => setField("ogImageUrl", e.target.value)}
                    disabled={!editable}
                  />
                </div>
              </div>

              <a
                href={link.destinationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3" />
                <span className="truncate">{link.destinationUrl}</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {editable && isDirty ? <FloatingBar onDiscard={discard} isSaving={isSaving} /> : null}
    </DashboardShell>
  );
}

function ShareForm({ chapters }: { chapters: UserChapter[] }) {
  const [principalType, setPrincipalType] = useState<"user" | "chapter">("user");
  const [chapterId, setChapterId] = useState<string>(
    chapters[0] ? String(chapters[0].chapterId) : "",
  );
  const [email, setEmail] = useState("");
  return (
    <Form
      method="post"
      className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-[140px_1fr_120px_auto]"
    >
      <input type="hidden" name="intent" value="addPermission" />
      <input type="hidden" name="principalType" value={principalType} />
      <Select
        value={principalType}
        onValueChange={(v) => setPrincipalType(v as "user" | "chapter")}
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
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      ) : (
        <>
          <input type="hidden" name="principalId" value={chapterId} />
          <Select value={chapterId} onValueChange={setChapterId}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Choose a chapter" />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((c) => (
                <SelectItem key={c.chapterId} value={String(c.chapterId)}>
                  {c.chapterSlug}
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
      <Button
        type="submit"
        size="sm"
        disabled={principalType === "chapter" ? chapterId === "" : email.trim() === ""}
      >
        Share
      </Button>
    </Form>
  );
}

function FloatingBar({ onDiscard, isSaving }: { onDiscard: () => void; isSaving: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 px-4 md:left-60">
      <div className="pointer-events-auto mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg">
        <p className="text-sm font-medium">Unsaved changes</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <Button type="submit" form="link-update" size="sm" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
