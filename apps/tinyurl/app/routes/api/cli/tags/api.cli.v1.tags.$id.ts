import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { requireCliActor } from "~/features/auth/cli-auth.server";
import {
  cliError,
  cliJson,
  cliMethodNotAllowed,
  parseCliJsonBody,
} from "~/features/cli-api/cli-http.server";
import { type TagActor, deleteTag, updateTag } from "~/features/tags";
import type { Route } from "./+types/api.cli.v1.tags.$id";
function id(raw: string | undefined) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const tagId = id(args.params.id);
  if (tagId === null) return cliError("not_found", 404);
  const actor: TagActor = {
    userId: auth.actor.user.id,
    chapterIds: auth.actor.chapters.map((chapter) => chapter.chapterId),
    isSuperAdmin: isSuperAdmin(auth.actor.user),
  };
  if (args.request.method === "DELETE") {
    return (await deleteTag(env.DB, { id: tagId, actor }))
      ? cliJson({ id: tagId, deleted: true })
      : cliError("not_found", 404);
  }
  if (args.request.method !== "PATCH") return cliMethodNotAllowed();
  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const { name, color } = parsed.value;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 32 ||
    (color !== undefined && color !== null && typeof color !== "string")
  )
    return cliError("invalid_request", 400);
  const result = await updateTag(env.DB, {
    id: tagId,
    name: name.trim(),
    color: typeof color === "string" ? color : null,
    actor,
  });
  if (result.ok) return cliJson({ tag: result.tag });
  return result.reason === "not_found" ? cliError("not_found", 404) : cliError("conflict", 409);
}
