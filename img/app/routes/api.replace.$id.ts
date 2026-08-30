import { isValidImageId } from "~/features/images/id";
import { replaceImageForActor } from "~/features/images/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { dashboardImageErrorResponse } from "~/lib/image-errors.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.replace.$id";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const id = args.params.id;
  if (!isValidImageId(id)) return new Response("Not found", { status: 404 });

  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);

  const form = await args.request.formData();
  const result = await replaceImageForActor(env, { user, chapters }, id, form.get("file"));
  if (!result.ok) return dashboardImageErrorResponse(result.error);

  const body: components["schemas"]["ImageId"] = { id: result.value.id };
  return Response.json(body);
}
