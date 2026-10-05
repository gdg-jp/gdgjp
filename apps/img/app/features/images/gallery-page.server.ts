import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { FolderBar, type FolderSelection } from "~/features/folders/components/folder-bar";
import { listFoldersForActor } from "~/features/folders/service.server";
import {
  GalleryGrid,
  GalleryGridSkeleton,
  type GalleryItem,
} from "~/features/images/components/gallery-grid";
import { deliveryUrl } from "~/features/images/img-url";
import { listImagesForActor } from "~/features/images/queries.server";
function parseFolderSelection(raw: string | null): FolderSelection {
  if (raw === "unfiled") return "unfiled";
  if (raw === null) return "all";
  const value = Number(raw);
  return Number.isInteger(value) ? value : "all";
}

export async function loadGallery(env: Env, request: Request) {
  const { user, chapters } = await requireUserWithChapter(env, request);
  const actor = { user, chapters };

  const url = new URL(request.url);
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
