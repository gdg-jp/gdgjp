import { deleteFolderForActor, renameFolderForActor } from "~/features/folders/service";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { dashboardFolderErrorResponse } from "~/lib/folder-errors.server";
import type { Route } from "./+types/api.folders.$id";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "PATCH" && args.request.method !== "DELETE") {
    return new Response("Method not allowed", { status: 405 });
  }
  const id = Number(args.params.id);
  if (!Number.isInteger(id)) return new Response("Not found", { status: 404 });

  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);
  const actor = { user, chapters };

  if (args.request.method === "DELETE") {
    const result = await deleteFolderForActor(env, actor, id);
    if (!result.ok) return dashboardFolderErrorResponse(result.error);
    return Response.json({ ok: true });
  }

  const form = await args.request.formData();
  const name = form.get("name");
  if (typeof name !== "string") return new Response("missing name", { status: 400 });

  const result = await renameFolderForActor(env, actor, id, name);
  if (!result.ok) return dashboardFolderErrorResponse(result.error);
  return Response.json({ folder: result.value });
}
