import { isValidImageId } from "~/features/images/id";
import {
  type UpdateImagePatch,
  deleteImageForActor,
  getImageForActor,
  imageUrl,
  replaceImageForActor,
  updateImageForActor,
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
    const result = await replaceImageForActor(
      env,
      args.context.cloudflare.ctx,
      auth.actor,
      id,
      form.get("file"),
    );
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
    const payload = (await args.request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    // Collect every provided field into one patch object before touching the
    // service layer, so validation of later fields (below, and inside
    // updateImageForActor) can never run after an earlier field has already
    // been written — the whole patch is applied atomically or not at all.
    const patch: UpdateImagePatch = {};
    if ("chapterId" in payload) {
      if (typeof payload.chapterId !== "number" || !Number.isInteger(payload.chapterId)) {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      patch.chapterId = payload.chapterId;
    }
    if ("folderId" in payload) {
      if (payload.folderId !== null && typeof payload.folderId !== "number") {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      patch.folderId = payload.folderId as number | null;
    }
    if ("slug" in payload) {
      if (payload.slug !== null && typeof payload.slug !== "string") {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      patch.slug = payload.slug as string | null;
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const result = await updateImageForActor(env, auth.actor, id, patch);
    if (!result.ok) return imageServiceErrorResponse(result.error);

    const body: components["schemas"]["CliImageResponse"] = { image: result.value };
    return Response.json(body, { headers: NO_STORE });
  }

  return new Response("Method not allowed", { status: 405 });
}
