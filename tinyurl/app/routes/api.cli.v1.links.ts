import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { createLinkWithExtras, listVisibleLinksPage } from "~/features/links";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.links";

function actor(auth: { actor: { user: import("@gdgjp/gdg-lib").AuthUser; chapters: import("@gdgjp/gdg-lib").UserChapter[] } }) {
  return { user: auth.actor.user, chapter: auth.actor.chapters[0]!, chapters: auth.actor.chapters };
}
function positive(raw: string | null): number | undefined | null {
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
function page(cursor: string | null): number { try { const n = Number(cursor ? atob(cursor) : 0); return Number.isInteger(n) && n >= 0 ? n : 0; } catch { return 0; } }

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const url = new URL(args.request.url);
  const folderId = positive(url.searchParams.get("folderId"));
  const tagId = positive(url.searchParams.get("tagId"));
  const limit = positive(url.searchParams.get("limit"));
  if (folderId === null || tagId === null || limit === null || (limit !== undefined && limit > 100)) return cliError("invalid_request", 400);
  const offset = page(url.searchParams.get("cursor"));
  const size = limit ?? 50;
  return cliJson(await listVisibleLinksPage(env.DB, { userId: auth.actor.user.id, email: auth.actor.user.email, chapterIds: auth.actor.chapters.map((chapter) => chapter.chapterId), isSuperAdmin: isSuperAdmin(auth.actor.user), ...(folderId ? { folderId } : {}), ...(tagId ? { tagId } : {}), limit: size, offset }));
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;
  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;
  if (typeof b.domainId !== "number" || typeof b.slug !== "string" || typeof b.destinationUrl !== "string" || (b.visibility !== "private" && b.visibility !== "public")) return cliError("invalid_request", 400);
  const result = await createLinkWithExtras({ db: env.DB }, actor(auth), b as Parameters<typeof createLinkWithExtras>[2]);
  return result.ok ? cliJson({ link: result.link }, { status: 201 }) : featureFailureResponse(result);
}
