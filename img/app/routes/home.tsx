import { Suspense } from "react";
import { Await } from "react-router";
import { FolderBar, type FolderSelection } from "~/components/folder-bar";
import { GalleryGrid, GalleryGridSkeleton, type GalleryItem } from "~/components/gallery-grid";
import { PageShell } from "~/components/page-shell";
import { UploadForm } from "~/components/upload-form";
import { listFoldersForActor } from "~/features/folders/service";
import { listImagesForActor } from "~/features/images/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { deliveryUrl } from "~/lib/img-url";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "GDG Japan Image" }];
}

function parseFolderSelection(raw: string | null): FolderSelection {
  if (raw === "unfiled") return "unfiled";
  if (raw === null) return "all";
  const value = Number(raw);
  return Number.isInteger(value) ? value : "all";
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);
  const actor = { user, chapters };

  const url = new URL(args.request.url);
  const selection = parseFolderSelection(url.searchParams.get("folder"));
  const folderId = selection === "all" ? undefined : selection === "unfiled" ? null : selection;

  const chapterSlugById = new Map(chapters.map((c) => [c.chapterId, c.chapterSlug]));
  const showChapterBadge = chapters.length > 1;

  const foldersResult = await listFoldersForActor(env, actor);
  const folders = foldersResult.ok ? foldersResult.value.folders : [];

  const items = listImagesForActor(env, actor, { folderId, limit: 60 }).then(
    (result): GalleryItem[] =>
      result.ok
        ? result.value.images.map((r) => ({
            id: r.id,
            thumbUrl: `${deliveryUrl(r.id, { w: 400, fit: "cover" })}&v=${r.updatedAt}`,
            filename: r.filename,
            chapterSlug: chapterSlugById.get(r.chapterId) ?? null,
          }))
        : [],
  );
  return {
    user: { email: user.email, image: user.image, name: user.name },
    chapters,
    folders,
    selection,
    showChapterBadge,
    items,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
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
