import { Button, Dialog, Icons, PageHeader, Stack, toast } from "@gdgjp/design-system";
import { Suspense, useEffect, useRef, useState } from "react";
import { Await, Link, useFetcher } from "react-router";
import {
  BUILT_IN_DISPLAY_DEFAULTS,
  type DisplayPreferences,
  readDisplayPreferences,
} from "~/features/dashboard/display-preferences";
import { shortHostOf } from "~/features/folders/components/folder-detail";
import { FolderLinksSkeleton } from "~/features/folders/components/folder-detail";
import { Breadcrumbs } from "~/features/folders/components/folder-detail";
import { FolderActions } from "~/features/folders/components/folder-detail";
import { CreateFolderForm } from "~/features/folders/components/folder-detail";
import { RenameFolderForm } from "~/features/folders/components/folder-detail";
import { ShareFolderDialog } from "~/features/folders/components/folder-detail";
import { DeleteFolderDialog } from "~/features/folders/components/folder-list";
import { loader as loadPage, action as mutatePage } from "~/features/folders/detail.server";

import type { FolderActionData } from "~/features/folders/list.server";
import { CreateLinkDialog } from "~/features/links/components/create-link-dialog";
import type { LinkCardItem } from "~/features/links/components/link-card";
import { LinkList } from "~/features/links/components/link-list";
import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/folders.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.folder.name ?? "Folder"} — GDG Japan Links` }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export function action(args: Route.ActionArgs) {
  return mutatePage(args);
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
      <Stack className="mx-auto w-full min-w-0 max-w-6xl">
        <PageHeader
          title={folder.name}
          back={<Breadcrumbs folders={breadcrumbs} />}
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
                      <Icons name="Link" aria-hidden="true" className="size-4" />
                      Create link
                    </Button>
                  }
                />
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  <Icons name="Plus" aria-hidden="true" className="size-4" />
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
          <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-surface/15 px-6 text-center">
            <Icons name="Folder" aria-hidden="true" className="mb-3 size-8 text-muted" />
            <h2 className="text-sm font-semibold">This folder is empty</h2>
            <p className="mt-1 text-sm text-muted">
              {editable
                ? "Create a link or folder to start organizing this space."
                : "There are no visible items in this folder."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {childFolders.length > 0 ? (
              <section aria-labelledby="child-folders-heading">
                <h2 id="child-folders-heading" className="mb-3 text-sm font-medium text-muted">
                  Folders
                </h2>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {childFolders.map((child) => (
                    <li key={child.id}>
                      <Link
                        to={`/folders/${child.id}`}
                        prefetch="intent"
                        className="flex min-h-20 items-center gap-3 rounded-xl border bg-surface/35 px-4 py-3 transition-colors hover:bg-surface/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                          <Icons name="Folder" aria-hidden="true" className="size-5 fill-current" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{child.name}</span>
                          <span className="block text-xs text-muted">
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
                <h2 id="folder-links-heading" className="mb-3 text-sm font-medium text-muted">
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
      </Stack>
    </DashboardShell>
  );
}
