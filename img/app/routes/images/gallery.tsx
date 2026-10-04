import { Suspense } from "react";
import { Await } from "react-router";
import { FolderBar } from "~/features/folders/components/folder-bar";
import { GalleryGrid, GalleryGridSkeleton } from "~/features/images/components/gallery-grid";
import { UploadForm } from "~/features/images/components/upload-form";
import { loadGallery } from "~/features/images/gallery-page.server";
import { PageShell } from "~/layouts/page-shell";
import type { Route } from "./+types/gallery";

export function meta() {
  return [{ title: "GDG Japan Image" }];
}

export function loader({ context, request }: Route.LoaderArgs) {
  return loadGallery(context.cloudflare.env, request);
}

export default function GalleryPage({ loaderData }: Route.ComponentProps) {
  const { user, chapters, folders, selection, showChapterBadge, items } = loaderData;
  const uploadFolderId = typeof selection === "number" ? selection : null;

  return (
    <PageShell user={user} size="lg">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chapter image library</h1>
          <p className="text-sm text-muted-foreground">
            Upload images and share <code>img.gdgs.jp/&lt;id&gt;</code> links. Anyone with the link
            can view; members of an image's chapter can manage it and organize it into folders.
          </p>
        </div>
        <FolderBar folders={folders} selected={selection} chapters={chapters} />
        <UploadForm folderId={uploadFolderId} />
        <Suspense fallback={<GalleryGridSkeleton />}>
          <Await
            resolve={items}
            errorElement={
              <div className="rounded-md border border-destructive/40 p-6 text-sm text-destructive">
                Images could not be loaded. Refresh the page to try again.
              </div>
            }
          >
            {(resolvedItems) => (
              <GalleryGrid items={resolvedItems} showChapterBadge={showChapterBadge} />
            )}
          </Await>
        </Suspense>
      </div>
    </PageShell>
  );
}
