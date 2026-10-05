import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import {
  removeMobileImageForActor,
  setMobileImageForActor,
} from "~/features/images/content.server";
import { dashboardImageErrorResponse } from "~/features/images/errors.server";
import { isValidImageId } from "~/features/images/id";
import type { components } from "../../../../openapi/types.generated";
import type { Route } from "./+types/mobile";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST" && args.request.method !== "DELETE") {
    return new Response("Method not allowed", { status: 405 });
  }
  const id = args.params.id;
  if (!isValidImageId(id)) return new Response("Not found", { status: 404 });

  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);
  const actor = { user, chapters };

  if (args.request.method === "DELETE") {
    const result = await removeMobileImageForActor(env, args.context.cloudflare.ctx, actor, id);
    if (!result.ok) return dashboardImageErrorResponse(result.error);
    return success();
  }

  const form = await args.request.formData();
  const result = await setMobileImageForActor(
    env,
    args.context.cloudflare.ctx,
    actor,
    id,
    form.get("file"),
  );
  if (!result.ok) return dashboardImageErrorResponse(result.error);

  const body: components["schemas"]["ImageId"] = { id: result.value.id };
  return Response.json(body);
}

function success() {
  const body: components["schemas"]["Success"] = { ok: true };
  return Response.json(body);
}
