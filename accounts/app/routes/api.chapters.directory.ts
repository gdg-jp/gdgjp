import type { LoaderFunctionArgs } from "react-router";
import { listChapters } from "~/lib/db";
import type { components } from "../../openapi/types.generated";

type ChapterDirectory = components["schemas"]["ChapterDirectory"];

/**
 * A deliberately small, cacheable directory used by relying-party share pickers.
 * Memberships remain private: this exposes only stable chapter metadata.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const query = new URL(request.url).searchParams.get("q")?.trim().toLocaleLowerCase() ?? "";
  const all = await listChapters(env.DB);
  const chapters = query
    ? all.filter((chapter) => {
        const candidate = `${chapter.name} ${chapter.slug}`.toLocaleLowerCase();
        return candidate.includes(query);
      })
    : all;

  const body: ChapterDirectory = {
    chapters: chapters.map(({ id, slug, name, kind, region }) => ({
      id: String(id),
      slug,
      name,
      kind,
      region,
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
}
