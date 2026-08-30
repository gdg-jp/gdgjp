import { PageShell } from "~/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { listFoldersForActor } from "~/features/folders/service";
import { ChapterCard } from "~/features/images/components/chapter-card";
import { FolderCard } from "~/features/images/components/folder-card";
import { MobileCard } from "~/features/images/components/mobile-card";
import { ReplaceCard } from "~/features/images/components/replace-card";
import { SlugCard } from "~/features/images/components/slug-card";
import { UrlBuilderCard } from "~/features/images/components/url-builder-card";
import { isValidImageId } from "~/features/images/id";
import { getImageForActor } from "~/features/images/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { deliveryUrl } from "~/lib/img-url";
import type { Route } from "./+types/i.$id";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Image ${params.id} — GDG Japan Image` }];
}

export async function loader(args: Route.LoaderArgs) {
  const id = args.params.id;
  if (!isValidImageId(id)) throw new Response("Not found", { status: 404 });
  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);
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

export default function ImageDetail({ loaderData }: Route.ComponentProps) {
  const { user, image, chapters, currentChapterSlug, foldersInChapter, appUrl, publicUrl, idUrl } =
    loaderData;
  return (
    <PageShell user={user} size="md">
      <div className="flex flex-col gap-6">
        <ReplaceCard image={image} publicUrl={publicUrl} />
        <MobileCard image={image} />
        <SlugCard image={image} />
        <UrlBuilderCard image={image} appUrl={appUrl} />
        <FolderCard image={image} folders={foldersInChapter} />
        <ChapterCard image={image} chapters={chapters} currentChapterSlug={currentChapterSlug} />
        <Card
          className="motion-stagger transition-shadow duration-300 hover:shadow-md"
          style={{ "--motion-index": 6 } as React.CSSProperties}
        >
          <CardHeader>
            <CardTitle className="text-base">Public URL</CardTitle>
            <CardDescription>
              {image.slug
                ? "Anyone with this link can view the image. It also stays reachable at its id URL."
                : "Anyone with this link can view the image."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              This URL is automatically optimized (AVIF/WebP, up to 1600px). Add{" "}
              <code>?f=original</code> to retrieve the unmodified file.
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="public-url" className="sr-only">
                Public URL
              </Label>
              <Input id="public-url" readOnly value={publicUrl} />
            </div>
            {image.slug ? (
              <div className="flex items-center gap-2">
                <Label htmlFor="id-url" className="sr-only">
                  Id URL
                </Label>
                <Input id="id-url" readOnly value={idUrl} className="text-muted-foreground" />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
