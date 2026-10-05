import { requireCliActor } from "~/features/auth/cli-auth.server";
import { imageServiceErrorResponse } from "~/features/images/cli-errors.server";
import { setMobileImageForActor } from "~/features/images/content.server";
import { isValidImageId } from "~/features/images/id";
import type { components } from "../../../../../openapi/types.generated";
import type { Route } from "./+types/mobile";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = args.params.id;
  if (!isValidImageId(id)) return Response.json({ error: "not_found" }, { status: 404 });

  const form = await args.request.formData();
  const result = await setMobileImageForActor(
    env,
    args.context.cloudflare.ctx,
    auth.actor,
    id,
    form.get("file"),
  );
  if (!result.ok) return imageServiceErrorResponse(result.error);

  const body: components["schemas"]["CliMobileResult"] = {
    id: result.value.id,
    updatedAt: result.value.updatedAt,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
