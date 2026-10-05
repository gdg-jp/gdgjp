import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { requireSuperAdmin } from "~/features/chapters/permissions";
import { bustChaptersWithCountsCache, getChapterById } from "~/features/chapters/repository.server";
import { approveMembership, removeMembership } from "~/features/memberships/mutations.server";
import { getMembership, listAllPendingRequests } from "~/features/memberships/repository.server";
import {
  sendJoinRequestApproved,
  sendJoinRequestRejected,
} from "~/features/notifications/email.server";
import { getUserById } from "~/features/users/repository.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadAdminRequests(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  // None of these depend on each other — fan everything out in parallel.
  const [t, userResult, requests, locale] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (u) => ({ ok: true as const, user: u }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    listAllPendingRequests(env.DB),
    i18n.getLocale(args.request),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  requireSuperAdmin(user);
  return {
    user,
    requests,
    locale,
    now: Math.floor(Date.now() / 1000),
    title: t("meta.adminRequests"),
  };
}

export async function actOnAdminRequests(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  const locale = (await i18n.getLocale(args.request)) === "ja" ? "ja" : "en";
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
  const intent = String(form.get("intent") ?? "");
  const userId = String(form.get("userId") ?? "");
  const chapterId = Number(form.get("chapterId"));
  if (!userId || !Number.isInteger(chapterId) || chapterId <= 0) {
    return { error: t("errors.unknownAction") };
  }
  const chapter = await getChapterById(env.DB, chapterId);
  if (!chapter) return { error: t("errors.chapterNotFound") };
  const membership = await getMembership(env.DB, userId, chapterId);
  if (!membership || membership.status !== "pending") {
    return { error: t("errors.userNotInChapter") };
  }

  if (intent === "approve") {
    await approveMembership(env.DB, userId, chapterId);
    await bustChaptersWithCountsCache();
    const u = await getUserById(env.DB, userId);
    if (u?.email) {
      sendJoinRequestApproved(
        { env, ctx: args.context.cloudflare.ctx, locale },
        { chapter, userEmail: u.email },
      );
    }
    return { ok: true, intent: "approve" as const };
  }
  if (intent === "reject") {
    const u = await getUserById(env.DB, userId);
    await removeMembership(env.DB, userId, chapterId);
    await bustChaptersWithCountsCache();
    if (u?.email) {
      sendJoinRequestRejected(
        { env, ctx: args.context.cloudflare.ctx, locale },
        { chapter, userEmail: u.email },
      );
    }
    return { ok: true, intent: "reject" as const };
  }
  return { error: t("errors.unknownAction") };
}
