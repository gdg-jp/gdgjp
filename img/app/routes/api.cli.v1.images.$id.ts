import { isValidImageId } from "~/features/images/id";
import {
  deleteImageForActor,
  getImageForActor,
  imageUrl,
  replaceImageForActor,
  setImageSlugForActor,
} from "~/features/images/service";
import { requireCliActor } from "~/lib/cli-auth.server";
import { imageServiceErrorResponse } from "~/lib/cli-errors.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.images.$id";

const NO_STORE = { "Cache-Control": "no-store" };

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = args.params.id;
  if (!isValidImageId(id)) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await getImageForActor(env, auth.actor, id);
  if (!result.ok) return imageServiceErrorResponse(result.error);

  const body: components["schemas"]["CliImageResponse"] = { image: result.value };
  return Response.json(body, { headers: NO_STORE });
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = args.params.id;
  if (!isValidImageId(id)) return Response.json({ error: "not_found" }, { status: 404 });

  if (args.request.method === "PUT") {
    const form = await args.request.formData();
    const result = await replaceImageForActor(env, auth.actor, id, form.get("file"));
    if (!result.ok) return imageServiceErrorResponse(result.error);

    const body: components["schemas"]["CliReplaceResult"] = {
      id: result.value.id,
      url: imageUrl(env, result.value.id),
      updatedAt: result.value.updatedAt,
    };
    return Response.json(body, { headers: NO_STORE });
  }

  if (args.request.method === "DELETE") {
    const result = await deleteImageForActor(env, args.context.cloudflare.ctx, auth.actor, id);
    if (!result.ok) return imageServiceErrorResponse(result.error);

    const body: components["schemas"]["CliDeleteResult"] = { id: result.value.id, deleted: true };
    return Response.json(body, { headers: NO_STORE });
  }

  if (args.request.method === "PATCH") {
    const payload = (await args.request.json().catch(() => null)) as { slug?: unknown } | null;
    if (!payload || !("slug" in payload)) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const slug =
      payload.slug === null || typeof payload.slug === "string"
        ? (payload.slug as string | null)
        : undefined;
    if (slug === undefined) return Response.json({ error: "invalid_request" }, { status: 400 });

    const result = await setImageSlugForActor(env, auth.actor, id, slug);
    if (!result.ok) return imageServiceErrorResponse(result.error);

    const body: components["schemas"]["CliImageResponse"] = { image: result.value };
    return Response.json(body, { headers: NO_STORE });
  }

  return new Response("Method not allowed", { status: 405 });
}
