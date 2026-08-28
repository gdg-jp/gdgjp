import { isValidImageId } from "~/features/images/id";
import { setImageSlugForActor } from "~/features/images/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { dashboardImageErrorResponse } from "~/lib/image-errors.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.slug.$id";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const id = args.params.id;
  if (!isValidImageId(id)) return new Response("Not found", { status: 404 });

  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);

  const slug = await readSlug(args.request);
  const result = await setImageSlugForActor(env, { user, chapters: [chapter] }, id, slug);
  if (!result.ok) return dashboardImageErrorResponse(result.error);

  const body: components["schemas"]["ImageId"] = { id: result.value.id };
  return Response.json(body);
}

/** Accepts the slug from a JSON `{ slug }` body or a `slug` form field. */
async function readSlug(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await request.json().catch(() => null)) as { slug?: unknown } | null;
    return typeof data?.slug === "string" ? data.slug : null;
  }
  const form = await request.formData();
  const value = form.get("slug");
  return typeof value === "string" ? value : null;
}
