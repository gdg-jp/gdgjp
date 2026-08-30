import { isValidImageId } from "~/features/images/id";
import { setMobileImageForActor } from "~/features/images/service";
import { requireCliActor } from "~/lib/cli-auth.server";
import { imageServiceErrorResponse } from "~/lib/cli-errors.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.images.$id.mobile";

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
