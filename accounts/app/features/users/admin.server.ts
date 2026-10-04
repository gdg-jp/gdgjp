import type { AuthUser } from "@gdgjp/gdg-lib";
import type { AppLoadContext } from "react-router";
import { redirect } from "react-router";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { requireSuperAdmin } from "~/features/chapters/permissions";
import { listChapters } from "~/features/chapters/repository.server";
import { i18n } from "~/lib/i18n/i18n.server";
import { pageUrl } from "./page-url";
import {
  listManagedUsers,
  revokeUserSessions,
  setUserAdmin,
  setUserChapters,
} from "./user-admin.server";

type RequestArgs = { request: Request; context: AppLoadContext };
const PAGE_SIZE = 25;

export async function loadUserAdmin(args: RequestArgs) {
  const env = args.context.cloudflare.env;
  const [t, userResult, locale] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (user) => ({ ok: true as const, user }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    i18n.getLocale(args.request),
  ]);
  if (!userResult.ok) {
    if (userResult.error instanceof Response && userResult.error.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.error;
  }
  requireSuperAdmin(userResult.user);

  const url = new URL(args.request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const requestedPage = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [result, chapters] = await Promise.all([
    listManagedUsers(env.DB, { query, page, pageSize: PAGE_SIZE }),
    listChapters(env.DB),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (page > pages) throw redirect(pageUrl(query, pages));
  return {
    ...result,
    chapters,
    query,
    user: userResult.user,
    locale,
    title: t("meta.adminUsers"),
  };
}

export async function actOnUserAdmin(args: RequestArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  let actor: AuthUser;
  try {
    actor = await requireUser(env, args.request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw error;
  }
  requireSuperAdmin(actor);

  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  const targetId = String(form.get("userId") ?? "");
  if (!targetId) return { error: t("adminUsers.errors.notFound") };

  if (intent === "set-admin") {
    if (targetId === actor.id) return { error: t("adminUsers.errors.selfAdmin") };
    const isAdmin = form.get("isAdmin") === "true";
    const result = await setUserAdmin(env.DB, { actorId: actor.id, targetId, isAdmin });
    if (result.status === "not_found") return { error: t("adminUsers.errors.notFound") };
    if (result.status === "last_admin") return { error: t("adminUsers.errors.lastAdmin") };
    return { ok: true, intent: isAdmin ? ("promote" as const) : ("demote" as const) };
  }

  if (intent === "revoke-sessions") {
    const result = await revokeUserSessions(env.DB, { actorId: actor.id, targetId });
    if (result.status === "not_found") return { error: t("adminUsers.errors.notFound") };
    if (result.status === "self_revoke") return { error: t("adminUsers.errors.selfRevoke") };
    return { ok: true, intent: "revoke" as const };
  }

  if (intent === "set-chapter") {
    const chapterIds = form
      .getAll("chapterIds")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    if (chapterIds.length === 0) {
      return { error: t("errors.selectChapter") };
    }
    const result = await setUserChapters(env.DB, { targetId, chapterIds });
    if (result.status === "not_found") return { error: t("adminUsers.errors.notFound") };
    if (result.status === "chapter_not_found") return { error: t("errors.chapterNotFound") };
    if (result.status === "last_active_organizer") {
      return { error: t("adminUsers.errors.lastActiveOrganizer") };
    }
    return { ok: true, intent: "chapter" as const };
  }

  return { error: t("adminUsers.errors.unknown") };
}
