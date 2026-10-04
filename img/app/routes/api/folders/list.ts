import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { dashboardFolderErrorResponse } from "~/features/folders/errors.server";
import { createFolderForActor, listFoldersForActor } from "~/features/folders/service.server";
import type { Route } from "./+types/list";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);

  const result = await listFoldersForActor(env, { user, chapters });
  if (!result.ok) return dashboardFolderErrorResponse(result.error);

  return Response.json({ folders: result.value.folders });
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);

  const form = await args.request.formData();
  const name = form.get("name");
  if (typeof name !== "string") return new Response("missing name", { status: 400 });
  const rawChapterId = form.get("chapterId");
  const chapterId =
    typeof rawChapterId === "string" && rawChapterId !== "" ? Number(rawChapterId) : null;
  if (chapterId !== null && !Number.isInteger(chapterId)) {
    return new Response("invalid chapterId", { status: 400 });
  }

  const result = await createFolderForActor(env, { user, chapters }, { name, chapterId });
  if (!result.ok) return dashboardFolderErrorResponse(result.error);

  return Response.json({ folder: result.value }, { status: 201 });
}
