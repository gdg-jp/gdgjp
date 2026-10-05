import {
  Button,
  Dialog,
  DialogTrigger,
  Icons,
  PageHeader,
  Stack,
  toast,
} from "@gdgjp/design-system";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { FolderMenu } from "~/features/folders/components/folder-list";
import { FolderForm } from "~/features/folders/components/folder-list";
import { DeleteFolderDialog } from "~/features/folders/components/folder-list";
import { loader as loadPage, action as mutatePage } from "~/features/folders/list.server";

import type { FolderActionData } from "~/features/folders/list.server";
import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/folders";

export function meta() {
  return [{ title: "Folders — GDG Japan Links" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export function action(args: Route.ActionArgs) {
  return mutatePage(args);
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
      <Stack className="mx-auto w-full min-w-0 max-w-6xl">
        <PageHeader
          title="Folders"
          description="Organize links and share folders with people or chapters."
          actions={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Icons name="Plus" aria-hidden="true" className="size-4" />
                  Create folder
                </Button>
              </DialogTrigger>
              <FolderForm fetcher={fetcher} />
            </Dialog>
          }
        />

        {folders.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-surface/15 px-6 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icons name="Folder" aria-hidden="true" className="size-5" />
            </span>
            <h2 className="text-sm font-semibold">No folders yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted">
              Create a folder to collect links and share them with your collaborators.
            </p>
          </div>
        ) : (
          <section aria-label="Folders">
            <p className="mb-3 text-sm font-medium text-muted">Name</p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {folders.map((folder) => (
                <li key={folder.id} className="relative min-w-0">
                  <Link
                    to={`/folders/${folder.id}`}
                    prefetch="intent"
                    className="group flex min-h-20 items-center gap-3 rounded-xl border bg-surface/35 px-4 py-3 pr-12 transition-colors hover:bg-surface/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                      <Icons name="Folder" aria-hidden="true" className="size-5 fill-current" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{folder.name}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
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
      </Stack>
    </DashboardShell>
  );
}
