import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { isChapterRegion } from "~/features/chapters/chapter-regions";
import { requireSuperAdmin } from "~/features/chapters/permissions";
import {
  bustChaptersWithCountsCache,
  createChapter,
  deleteChapter,
  listChaptersWithCountsCached,
} from "~/features/chapters/repository.server";
import type { ChapterKind } from "~/features/chapters/types";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadAdminChapters(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  // listChaptersWithCountsCached doesn't depend on the user; fan it out with auth.
  const [t, userResult, chapters] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (u) => ({ ok: true as const, user: u }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    listChaptersWithCountsCached(env.DB),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  requireSuperAdmin(user);
  return { user, chapters, title: t("meta.adminChapters") };
}

export async function actOnAdminChapters(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  let user: AuthUser;
  try {
    user = await requireUser(env, args.request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw err;
  }
  requireSuperAdmin(user);
  const form = await args.request.formData();
  const intent = form.get("intent");
  if (intent === "delete") {
    const id = Number(form.get("id"));
    if (Number.isInteger(id) && id > 0) {
      await deleteChapter(env.DB, id);
      await bustChaptersWithCountsCache();
    }
    return null;
  }
  if (intent === "create") {
    const slug = String(form.get("slug") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const kind = String(form.get("kind") ?? "") as ChapterKind;
    const regionRaw = String(form.get("region") ?? "").trim();
    if (!slug || !name || (kind !== "gdg" && kind !== "gdgoc") || !isChapterRegion(regionRaw)) {
      return { error: t("errors.fieldsRequired") };
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return { error: t("errors.slugFormat") };
    }
    try {
      await createChapter(env.DB, { slug, name, kind, region: regionRaw });
    } catch {
      return { error: t("errors.createChapterFailed") };
    }
    await bustChaptersWithCountsCache();
    return null;
  }
  return { error: t("errors.unknownAction") };
}
