import { isValidImageId } from "~/features/images/id";
import { deleteImageForActor } from "~/features/images/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { dashboardImageErrorResponse } from "~/lib/image-errors.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.delete.$id";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const id = args.params.id;
  if (!isValidImageId(id)) return new Response("Not found", { status: 404 });

  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);

  const result = await deleteImageForActor(
    env,
    args.context.cloudflare.ctx,
    { user, chapters: [chapter] },
    id,
  );
  if (!result.ok) return dashboardImageErrorResponse(result.error);

  const body: components["schemas"]["Success"] = { ok: true };
  return Response.json(body);
}
