import { Suspense } from "react";
import { Await } from "react-router";
import { GalleryGrid, GalleryGridSkeleton, type GalleryItem } from "~/components/gallery-grid";
import { PageShell } from "~/components/page-shell";
import { UploadForm } from "~/components/upload-form";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { listImagesByUser } from "~/lib/images";
import { deliveryUrl } from "~/lib/img-url";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "GDG Japan Image" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, args.request);
  const items = listImagesByUser(env.DB, user.id).then((rows): GalleryItem[] =>
    rows.map((r) => ({
      id: r.id,
      thumbUrl: `${deliveryUrl(r.id, { w: 400, fit: "cover" })}&v=${r.updatedAt}`,
      filename: r.filename,
    })),
  );
  return { user: { email: user.email, name: user.name }, items };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, items } = loaderData;
  return (
    <PageShell user={user} size="lg">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your images</h1>
          <p className="text-sm text-muted-foreground">
            Upload images and share <code>img.gdgs.jp/&lt;id&gt;</code> links. Anyone with the link
            can view; only chapter members can upload.
          </p>
        </div>
        <UploadForm />
        <Suspense fallback={<GalleryGridSkeleton />}>
          <Await
            resolve={items}
            errorElement={
              <div className="rounded-md border border-destructive/40 p-6 text-sm text-destructive">
                Images could not be loaded. Refresh the page to try again.
              </div>
            }
          >
            {(resolvedItems) => <GalleryGrid items={resolvedItems} />}
          </Await>
        </Suspense>
      </div>
    </PageShell>
  );
}
