import {
  canEditLinkForChapters,
  canViewLinkForChapters,
  getLinkById,
  listPermissionsForLink,
  parseUpdateLinkPatch,
  softDeleteLink,
  updateLinkWithExtras,
} from "~/features/links";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.links.$id";
function serviceActor(auth: {
  actor: {
    user: import("@gdgjp/gdg-lib").AuthUser;
    chapters: import("@gdgjp/gdg-lib").UserChapter[];
  };
}) {
  return { user: auth.actor.user, chapters: auth.actor.chapters, selectedChapterId: null };
}
async function loaded(
  env: Env,
  auth: {
    actor: {
      user: import("@gdgjp/gdg-lib").AuthUser;
      chapters: import("@gdgjp/gdg-lib").UserChapter[];
    };
  },
  id: string,
) {
  const link = await getLinkById(env.DB, id);
  if (!link) return null;
  return { link, permissions: await listPermissionsForLink(env.DB, id) };
}
export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const item = await loaded(env, auth, args.params.id ?? "");
  if (!item) return cliError("not_found", 404);
  return canViewLinkForChapters(
    auth.actor.user,
    auth.actor.chapters.map((c) => c.chapterId),
    item.link,
    item.permissions,
  )
    ? cliJson({ link: item.link })
    : cliError("forbidden", 403);
}
export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const item = await loaded(env, auth, args.params.id ?? "");
  if (!item) return cliError("not_found", 404);
  if (
    !canEditLinkForChapters(
      auth.actor.user,
      auth.actor.chapters.map((c) => c.chapterId),
      item.link,
      item.permissions,
    )
  )
    return cliError("forbidden", 403);
  if (args.request.method === "DELETE") {
    await softDeleteLink(env.DB, item.link.id);
    return cliJson({ id: item.link.id, deleted: true });
  }
  if (args.request.method !== "PATCH") return cliMethodNotAllowed();
  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const patch = parseUpdateLinkPatch(parsed.value);
  if (!patch.ok) return featureFailureResponse(patch);
  const result = await updateLinkWithExtras(
    { db: env.DB },
    serviceActor(auth),
    item.link.id,
    patch.value,
  );
  return result.ok ? cliJson({ link: result.link }) : featureFailureResponse(result);
}
