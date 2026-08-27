import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { createTag, listTagsForActorPage } from "~/features/tags";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.tags";
function page(cursor: string | null): number {
  try {
    const n = Number(cursor ? atob(cursor) : 0);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const url = new URL(args.request.url);
  const raw = url.searchParams.get("limit");
  const limit = raw === null ? 50 : Number(raw);
  const offset = page(url.searchParams.get("cursor"));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return cliError("invalid_request", 400);
  return cliJson(
    await listTagsForActorPage(env.DB, {
      userId: auth.actor.user.id,
      chapterIds: auth.actor.chapters.map((chapter) => chapter.chapterId),
      isSuperAdmin: isSuperAdmin(auth.actor.user),
      limit,
      offset,
    }),
  );
}
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
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
  const result = await createTag(env.DB, {
    name: name.trim(),
    color: typeof color === "string" ? color : null,
    ownerUserId: auth.actor.user.id,
  });
  return result.ok ? cliJson({ tag: result.tag }, { status: 201 }) : cliError("conflict", 409);
}
