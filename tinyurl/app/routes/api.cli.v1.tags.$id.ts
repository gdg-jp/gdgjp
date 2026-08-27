import { type AuthUser, type UserChapter, isSuperAdmin } from "@gdgjp/gdg-lib";
import { deleteTag, getTagById, updateTag } from "~/features/tags";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.tags.$id";
function id(raw: string | undefined) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
function canManageTag(
  tag: { ownerUserId: string | null; ownerChapterId: number | null },
  auth: { actor: { user: AuthUser; chapters: UserChapter[] } },
) {
  return (
    isSuperAdmin(auth.actor.user) ||
    tag.ownerUserId === auth.actor.user.id ||
    (tag.ownerChapterId !== null &&
      auth.actor.chapters.some((chapter) => chapter.chapterId === tag.ownerChapterId))
  );
}
export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const tagId = id(args.params.id);
  if (tagId === null) return cliError("not_found", 404);
  const tag = await getTagById(env.DB, tagId);
  if (!tag) return cliError("not_found", 404);
  if (!canManageTag(tag, auth)) return cliError("forbidden", 403);
  if (args.request.method === "DELETE") {
    await deleteTag(env.DB, tagId);
    return cliJson({ id: tagId, deleted: true });
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
  });
  return result.ok ? cliJson({ tag: result.tag }) : cliError("conflict", 409);
}
