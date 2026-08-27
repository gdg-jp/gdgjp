import { isSuperAdmin } from "@gdgjp/gdg-lib";
import {
  canEditFolder,
  canViewFolder,
  deleteFolder,
  getFolderById,
  updateFolder,
} from "~/features/folders";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.folders.$id";
function viewer(auth: {
  actor: { user: import("@gdgjp/gdg-lib").AuthUser; chapters: { chapterId: number }[] };
}) {
  return {
    userId: auth.actor.user.id,
    email: auth.actor.user.email,
    chapterIds: auth.actor.chapters.map((c) => c.chapterId),
    isSuperAdmin: isSuperAdmin(auth.actor.user),
  };
}
function parse(raw: string | undefined) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const id = parse(args.params.id);
  if (id === null || !(await getFolderById(env.DB, id))) return cliError("not_found", 404);
  return (await canViewFolder(env.DB, id, viewer(auth)))
    ? cliJson({ folder: await getFolderById(env.DB, id) })
    : cliError("forbidden", 403);
}
export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const id = parse(args.params.id);
  if (id === null || !(await getFolderById(env.DB, id))) return cliError("not_found", 404);
  if (!(await canEditFolder(env.DB, id, viewer(auth)))) return cliError("forbidden", 403);
  if (args.request.method === "DELETE") {
    const deleted = await deleteFolder(env.DB, { id, actor: viewer(auth) });
    return deleted ? cliJson({ id, deleted: true }) : cliError("conflict", 409);
  }
  if (args.request.method !== "PATCH") return cliMethodNotAllowed();
  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  if (
    typeof parsed.value.name !== "string" ||
    !parsed.value.name.trim() ||
    parsed.value.name.trim().length > 48
  )
    return cliError("invalid_request", 400);
  const result = await updateFolder(env.DB, {
    id,
    name: parsed.value.name.trim(),
    actor: viewer(auth),
  });
  return result.ok
    ? cliJson({ folder: result.folder })
    : cliError(
        result.reason === "duplicate" ? "conflict" : result.reason,
        result.reason === "duplicate" ? 409 : result.reason === "forbidden" ? 403 : 404,
      );
}
