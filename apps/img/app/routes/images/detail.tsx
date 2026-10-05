import { Button, Card, Heading, Input, Label, PageHeader, Stack, Text } from "@gdgjp/design-system";
import { Link } from "react-router";
import { ChapterCard } from "~/features/images/components/chapter-card";
import { FolderCard } from "~/features/images/components/folder-card";
import { MobileCard } from "~/features/images/components/mobile-card";
import { ReplaceCard } from "~/features/images/components/replace-card";
import { SlugCard } from "~/features/images/components/slug-card";
import { UrlBuilderCard } from "~/features/images/components/url-builder-card";
import { loadImageDetail } from "~/features/images/detail-page.server";
import { PageShell } from "~/layouts/page-shell";
import type { Route } from "./+types/detail";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Image ${params.id} — GDG Japan Image` }];
}

export function loader({ context, request, params }: Route.LoaderArgs) {
  return loadImageDetail(context.cloudflare.env, request, params.id);
}

export default function ImageDetailPage({ loaderData }: Route.ComponentProps) {
  const { user, image, chapters, currentChapterSlug, foldersInChapter, appUrl, publicUrl, idUrl } =
    loaderData;
  return (
    <PageShell user={user} size="md">
      <Stack className="gap-6">
        <PageHeader
          title="Image details"
          back={
            <Button asChild variant="ghost">
              <Link to="/">Back to library</Link>
            </Button>
          }
        />
        <ReplaceCard image={image} publicUrl={publicUrl} />
        <MobileCard image={image} />
        <SlugCard image={image} />
        <UrlBuilderCard image={image} appUrl={appUrl} />
        <FolderCard image={image} folders={foldersInChapter} />
        <ChapterCard image={image} chapters={chapters} currentChapterSlug={currentChapterSlug} />
        <Card className="flex flex-col gap-4">
          <div>
            <Heading className="text-base">Public URL</Heading>
            <Text tone="muted" size="sm">
              {image.slug
                ? "Anyone with this link can view the image. It also stays reachable at its id URL."
                : "Anyone with this link can view the image."}
            </Text>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
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
                <Input id="id-url" readOnly value={idUrl} className="text-muted" />
              </div>
            ) : null}
          </div>
        </Card>
      </Stack>
    </PageShell>
  );
}
