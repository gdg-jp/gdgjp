import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  Button,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Textarea,
  toast,
} from "@gdgjp/design-system";
import { QRCodeSVG } from "qrcode.react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Await, Form, Link, useNavigation } from "react-router";
import type { LinkVisibility } from "~/features/links";
import { formatDateShort } from "~/features/links/components/edit-fields";
import { userInitials } from "~/features/links/components/edit-fields";
import { hostnameOf } from "~/features/links/components/edit-fields";
import { shortHostOf } from "~/features/links/components/edit-fields";
import { faviconUrl } from "~/features/links/components/edit-fields";
import { PermissionRow } from "~/features/links/components/edit-fields";
import { ShareForm } from "~/features/links/components/edit-fields";
import { FloatingBar } from "~/features/links/components/edit-fields";
import { type LinkAction, LinkActionDialog } from "~/features/links/components/link-action-dialog";
import { loader as loadPage, action as mutatePage } from "~/features/links/detail.server";

import type { Draft } from "~/features/links/edit-draft";
import { buildInitial } from "~/features/links/edit-draft";
import { draftEqual } from "~/features/links/edit-draft";
import { shortDomainLabel, shortLinkDisplay } from "~/features/links/short-url";
import { TagCombobox } from "~/features/tags/components/tag-combobox";
import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/links.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.link.slug ?? "Link"} — GDG Japan Links` }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export function action(args: Route.ActionArgs) {
  return mutatePage(args);
}

export default function EditLink({ loaderData, actionData }: Route.ComponentProps) {
  const {
    link,
    availableTags,
    availableFolders,
    permissions,
    users,
    editable,
    chapters,
    chapterNameById,
    shortUrlBase,
    domainOptions,
  } = loaderData;
  const owner = users[link.ownerUserId];

  const initial = useMemo(() => buildInitial(loaderData), [loaderData]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const [slugDialogOpen, setSlugDialogOpen] = useState(false);
  const [linkAction, setLinkAction] = useState<LinkAction | null>(null);
  const selectedDomain = domainOptions.find((domain) => domain.id === draft.domainId);
  const shortHost = selectedDomain?.hostname ?? link.domainHostname ?? shortHostOf(shortUrlBase);
  const apexShortUrl = `https://${shortHost}/${draft.slug}`;
  const shortDisplay = shortLinkDisplay(shortHost, draft.slug);
  const favicon = faviconUrl(draft.destinationUrl);
  useEffect(() => {
    setDraft(initial);
    setSlugUnlocked(false);
  }, [initial]);

  const navigation = useNavigation();
  const submittingIntent = navigation.formData?.get("intent");
  const isSaving = navigation.state !== "idle" && submittingIntent === "update";
  const isFetchingOgp = navigation.state !== "idle" && submittingIntent === "fetchOgp";

  const lastToastedRef = useRef<unknown>(null);
  useEffect(() => {
    if (!actionData || lastToastedRef.current === actionData) return;
    lastToastedRef.current = actionData;
    if ("success" in actionData && actionData.success) {
      toast.success("Successfully updated short link!", {
        icon: <Icons name="Check" aria-hidden="true" className="size-4" />,
      });
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

  function copyGoAlias() {
    navigator.clipboard.writeText(shortDisplay).then(() => toast.success("Copied go link"));
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <DashboardShell user={loaderData.user}>
      <Stack className="pb-24">
        {/* Top bar: breadcrumb + actions */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <nav className="flex min-w-0 items-center gap-2 text-sm" aria-label="Breadcrumb">
            <Link
              to="/links"
              className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-foreground hover:bg-selected"
            >
              <Icons name="Folder" aria-hidden="true" className="size-4 text-primary" />
              Links
            </Link>
            <Icons name="ChevronRight" aria-hidden="true" className="size-4 shrink-0 text-muted" />
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-surface px-2 py-1 font-medium">
              {favicon ? (
                <img src={favicon} alt="" width={16} height={16} className="size-4 rounded-sm" />
              ) : (
                <Icons name="ExternalLink" aria-hidden="true" className="size-4 text-muted" />
              )}
              <span className="truncate">{shortDisplay}</span>
            </span>
          </nav>
          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            {shortHost === "go.gdgs.jp" ? (
              <Button variant="outline" size="sm" onClick={copyGoAlias}>
                <Icons name="Copy" aria-hidden="true" className="size-4" />
                Copy go link
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={copyShort}>
              <Icons name="Copy" aria-hidden="true" className="size-4" />
              Copy link
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`/analytics?linkId=${link.id}`} prefetch="intent">
                <Icons
                  name="ChartColumnIncreasing"
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
                <Suspense fallback={<span>Clicks</span>}>
                  <Await resolve={loaderData.clicks}>
                    {(clicks) => `${clicks} ${clicks === 1 ? "click" : "clicks"}`}
                  </Await>
                </Suspense>
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="outline" aria-label="Link actions">
                  <Icons name="MoreHorizontal" aria-hidden="true" className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {shortHost === "go.gdgs.jp" ? (
                  <DropdownMenuItem onSelect={copyGoAlias}>
                    <Icons name="Copy" aria-hidden="true" className="size-4" />
                    Copy go/{draft.slug}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={copyShort}>
                  <Icons name="Copy" aria-hidden="true" className="size-4" />
                  Copy short URL
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={link.destinationUrl} target="_blank" rel="noopener noreferrer">
                    <Icons name="ExternalLink" aria-hidden="true" className="size-4" />
                    Visit destination
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={apexShortUrl} target="_blank" rel="noopener noreferrer">
                    <Icons name="ExternalLink" aria-hidden="true" className="size-4" />
                    Visit short URL
                  </a>
                </DropdownMenuItem>
                {editable ? (
                  <>
                    <DropdownMenuSeparator />
                    {link.archivedAt === null ? (
                      <DropdownMenuItem onSelect={() => setLinkAction("archive")}>
                        <Icons name="Archive" aria-hidden="true" className="size-4" />
                        Archive link…
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="text-danger"
                      onSelect={() => setLinkAction("delete")}
                    >
                      <Icons name="Trash2" aria-hidden="true" className="size-4" />
                      Delete link…
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {linkAction ? (
          <LinkActionDialog
            action={linkAction}
            linkId={link.id}
            linkSlug={shortDisplay}
            destinationUrl={link.destinationUrl}
            open
            onOpenChange={(open) => !open && setLinkAction(null)}
          />
        ) : null}

        {actionData && "error" in actionData && actionData.error ? (
          <Alert tone="danger" title="Error">
            {actionData.error}
          </Alert>
        ) : null}

        {/* Hidden update form submits the controlled draft edited by the visible inputs. */}
        <Form id="link-update" method="post" className="hidden">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="manageTags" value="1" />
          <input type="hidden" name="domainId" value={draft.domainId} />
          <input type="hidden" name="destinationUrl" value={draft.destinationUrl} />
          <input type="hidden" name="slug" value={draft.slug} />
          <input type="hidden" name="title" value={draft.title} />
          <input type="hidden" name="description" value={draft.description} />
          <input type="hidden" name="ogImageUrl" value={draft.ogImageUrl} />
          <input type="hidden" name="comment" value={draft.comment} />
          <input type="hidden" name="visibility" value={draft.visibility} />
          <input type="hidden" name="folderId" value={draft.folderId ?? ""} />
          {draft.tagIds.map((tagId) => (
            <input key={`tag-${tagId}`} type="hidden" name="tagId" value={tagId} />
          ))}
          {draft.newTagNames.map((name, idx) => (
            <input key={`new-tag-${idx}-${name}`} type="hidden" name="newTagName" value={name} />
          ))}
        </Form>

        {/* Body grid */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* LEFT COLUMN */}
          <div className="min-w-0 space-y-8">
            {/* Destination URL */}
            <FormField id="destinationUrl" label={<>Destination URL</>} required>
              <Input
                id="destinationUrl"
                type="url"
                value={draft.destinationUrl}
                onChange={(e) => setField("destinationUrl", e.target.value)}
                required
                disabled={!editable}
              />
            </FormField>

            {/* Short Link */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="slug">Short Link</Label>
                {editable ? (
                  <AlertDialog open={slugDialogOpen} onOpenChange={setSlugDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <IconButton
                        type="button"
                        variant="ghost"
                        aria-label="Edit short link"
                        disabled={slugUnlocked}
                      >
                        <Icons name="Pencil" aria-hidden="true" className="size-3.5 text-muted" />
                      </IconButton>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <div className="space-y-2">
                        <AlertDialogTitle>Edit short link?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Editing an existing short link could potentially break existing links. Are
                          you sure you want to continue?
                        </AlertDialogDescription>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button
                            variant="danger"
                            onClick={() => {
                              setSlugUnlocked(true);
                              setSlugDialogOpen(false);
                            }}
                          >
                            Continue
                          </Button>
                        </AlertDialogAction>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>
              <div className="flex min-w-0 gap-2">
                <Select
                  value={String(draft.domainId)}
                  onValueChange={(value) => setField("domainId", Number(value))}
                  disabled={!editable || !slugUnlocked}
                >
                  <SelectTrigger
                    aria-label="Short link domain"
                    className="h-9 min-w-32 shrink-0 bg-surface text-muted shadow-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {domainOptions.map((domain) => (
                      <SelectItem key={domain.id} value={String(domain.id)}>
                        {shortDomainLabel(domain.hostname)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id="slug"
                  value={draft.slug}
                  onChange={(e) => setField("slug", e.target.value)}
                  pattern="[a-zA-Z0-9_\-]{1,64}"
                  required
                  disabled={!editable || !slugUnlocked}
                  className="min-w-0 flex-1"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Tags</Label>
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

            {/* Folder */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="folder">Folder</Label>
                <Link
                  to="/folders"
                  prefetch="intent"
                  className="text-xs text-muted hover:text-foreground"
                >
                  Manage
                </Link>
              </div>
              <Select
                value={draft.folderId === null ? "none" : String(draft.folderId)}
                onValueChange={(value) =>
                  setField("folderId", value === "none" ? null : Number(value))
                }
                disabled={!editable}
              >
                <SelectTrigger id="folder" className="max-w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No folder</SelectItem>
                  {availableFolders.map((folder) => (
                    <SelectItem key={folder.id} value={String(folder.id)}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Comment (single) */}
            <FormField id="comment" label={<>Comment</>}>
              <Textarea
                id="comment"
                value={draft.comment}
                onChange={(e) => setField("comment", e.target.value)}
                placeholder="Add a comment"
                maxLength={2000}
                rows={3}
                disabled={!editable}
              />
            </FormField>

            {/* Visibility */}
            <FormField id="visibility" label={<>Visibility</>}>
              <Select
                value={draft.visibility}
                onValueChange={(value) => setField("visibility", value as LinkVisibility)}
                disabled={!editable}
              >
                <SelectTrigger id="visibility" className="max-w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">
                    Private — only you and people you share with
                  </SelectItem>
                  <SelectItem value="public">Anyone in GDG Japan can view</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {/* Sharing */}
            <div className="space-y-3">
              <Label>Sharing</Label>
              <div className="rounded-md border bg-surface">
                {permissions.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted">Not shared with anyone.</p>
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
            <div className="flex min-w-0 items-center gap-2 border-t pt-4 text-sm text-muted">
              <Avatar alt="" fallback={userInitials(users, link.ownerUserId)} />
              <span className="min-w-0 break-words">
                Created by{" "}
                <span className="break-all font-medium text-foreground">
                  {owner ? owner.email || owner.name || link.ownerUserId : link.ownerUserId}
                </span>
                {" · "}
                {formatDateShort(link.createdAt)}
              </span>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="min-w-0 space-y-6">
            {/* QR Code */}
            <div className="space-y-2">
              <Label>QR Code</Label>
              <div className="flex items-center justify-center rounded-md border bg-surface p-4">
                <QRCodeSVG
                  value={apexShortUrl}
                  size={140}
                  bgColor="transparent"
                  className="dark:[&_path:last-of-type]:fill-white"
                />
              </div>
              <p className="break-all text-center font-mono text-xs text-muted">{apexShortUrl}</p>
            </div>

            {/* Custom Link Preview */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Custom Link Preview</Label>
                {editable ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="fetchOgp" />
                    <input type="hidden" name="destinationUrl" value={draft.destinationUrl} />
                    <Button type="submit" variant="ghost" size="sm" loading={isFetchingOgp}>
                      {isFetchingOgp ? null : (
                        <Icons name="RefreshCw" aria-hidden="true" className="size-3" />
                      )}
                      Fetch
                    </Button>
                  </Form>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-md border bg-surface">
                {draft.ogImageUrl ? (
                  <img
                    src={draft.ogImageUrl}
                    alt="OGP preview"
                    className="aspect-video w-full bg-surface object-cover"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-surface text-xs text-muted">
                    Enter a link to generate a preview
                  </div>
                )}
                <div className="space-y-1 px-3 py-2">
                  <p className="truncate text-sm font-medium">
                    {draft.title || hostnameOf(draft.destinationUrl) || "Untitled"}
                  </p>
                  {draft.description ? (
                    <p className="line-clamp-2 text-xs text-muted">{draft.description}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <FormField id="title" label={<>Title</>}>
                  <Input
                    id="title"
                    value={draft.title}
                    onChange={(e) => setField("title", e.target.value)}
                    disabled={!editable}
                  />
                </FormField>
                <FormField id="description" label={<>Description</>}>
                  <Textarea
                    id="description"
                    value={draft.description}
                    onChange={(e) => setField("description", e.target.value)}
                    disabled={!editable}
                    rows={2}
                  />
                </FormField>
                <FormField id="ogImageUrl" label={<>Image URL</>}>
                  <Input
                    id="ogImageUrl"
                    type="url"
                    value={draft.ogImageUrl}
                    onChange={(e) => setField("ogImageUrl", e.target.value)}
                    disabled={!editable}
                  />
                </FormField>
              </div>

              <a
                href={link.destinationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-start gap-1 text-xs text-muted hover:text-foreground"
              >
                <Icons name="ExternalLink" aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                <span className="break-all">{link.destinationUrl}</span>
              </a>
            </div>
          </div>
        </div>
      </Stack>

      {editable && isDirty ? <FloatingBar onDiscard={discard} isSaving={isSaving} /> : null}
    </DashboardShell>
  );
}
