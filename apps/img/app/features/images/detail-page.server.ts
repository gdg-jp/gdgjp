import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { listFoldersForActor } from "~/features/folders/service.server";
import { isValidImageId } from "~/features/images/id";
import { deliveryUrl } from "~/features/images/img-url";
import { getImageForActor } from "~/features/images/queries.server";
export async function loadImageDetail(env: Env, request: Request, id: string) {
  if (!isValidImageId(id)) throw new Response("Not found", { status: 404 });
  const { user, chapters } = await requireUserWithChapter(env, request);
  const actor = { user, chapters };
  const result = await getImageForActor(env, actor, id);
  if (!result.ok) {
    throw new Response(result.error === "not_found" ? "Not found" : "Forbidden", {
      status: result.error === "not_found" ? 404 : 403,
    });
  }
  const image = result.value;
  const appUrl = env.APP_URL.replace(/\/$/, "");
  const folders = await listFoldersForActor(env, actor, { chapterId: image.chapterId });
  const chapterSlugById = new Map(
    chapters.map((chapter) => [chapter.chapterId, chapter.chapterSlug]),
  );
  return {
    user: { email: user.email, image: user.image, name: user.name },
    image: {
      id: image.id,
      slug: image.slug,
      url: deliveryUrl(image.id, { w: 1600 }),
      filename: image.filename,
      contentType: image.contentType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      updatedAt: image.updatedAt,
      chapterId: image.chapterId,
      folderId: image.folderId,
      mobile: image.mobileR2Key
        ? {
            filename: image.mobileFilename,
            contentType: image.mobileContentType,
            byteSize: image.mobileByteSize,
            updatedAt: image.mobileUpdatedAt,
            url: deliveryUrl(image.id, { w: 1600, variant: "mobile" }),
          }
        : null,
    },
    chapters,
    currentChapterSlug: chapterSlugById.get(image.chapterId) ?? `#${image.chapterId}`,
    foldersInChapter: folders.ok
      ? folders.value.folders.map((folder) => ({ id: folder.id, name: folder.name }))
      : [],
    appUrl,
    publicUrl: image.slug ? `${appUrl}/${image.slug}` : `${appUrl}/${image.id}`,
    idUrl: `${appUrl}/${image.id}`,
  };
}
