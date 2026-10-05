import type { AuthUser } from "@gdgjp/gdg-lib";
import type { AppLoadContext } from "react-router";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { canManageChapter } from "~/features/chapters/permissions";
import {
  bustChaptersWithCountsCache,
  getChapterBySlug,
} from "~/features/chapters/repository.server";
import {
  approveMembership,
  demoteMembershipUnlessLastOrganizer,
  removeMembershipUnlessLastOrganizer,
  setRole,
} from "~/features/memberships/mutations.server";
import {
  getMembership,
  listMembersForChapter,
  listPendingForChapter,
} from "~/features/memberships/repository.server";
import {
  sendJoinRequestApproved,
  sendJoinRequestRejected,
} from "~/features/notifications/email.server";
import { type UserSummary, getUserById, getUsersByIds } from "~/features/users/repository.server";
import { i18n } from "~/lib/i18n/i18n.server";
type RequestArgs = { request: Request; context: AppLoadContext; params: { slug?: string } };

async function resolveUserAndChapter(args: RequestArgs) {
  const env = args.context.cloudflare.env;
  const slug = args.params.slug;
  if (!slug) throw new Response("Not found", { status: 404 });
  const [userResult, chapter] = await Promise.all([
    requireUser(env, args.request).then(
      (u) => ({ ok: true as const, user: u }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    getChapterBySlug(env.DB, slug),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  if (!chapter) throw new Response("Chapter not found", { status: 404 });
  return { env, user, chapter };
}

export async function loadChapterManagement(args: RequestArgs) {
  const { env, user, chapter } = await resolveUserAndChapter(args);
  const [t, viewerMembership, pending, members] = await Promise.all([
    i18n.getFixedT(args.request),
    getMembership(env.DB, user.id, chapter.id),
    listPendingForChapter(env.DB, chapter.id),
    listMembersForChapter(env.DB, chapter.id),
  ]);
  if (!canManageChapter(user, chapter.id, viewerMembership)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ids = [...new Set([...pending.map((m) => m.userId), ...members.map((m) => m.userId)])];
  const users = ids.length > 0 ? await getUsersByIds(env.DB, ids) : {};
  return {
    user,
    chapter,
    pending,
    members,
    users,
    title: t("meta.organize", { slug: chapter.slug }),
  };
}

export async function actOnChapterManagement(args: RequestArgs) {
  const { env, chapter, user } = await resolveUserAndChapter(args);
  const [t, viewerMembership, rawLocale] = await Promise.all([
    i18n.getFixedT(args.request),
    getMembership(env.DB, user.id, chapter.id),
    i18n.getLocale(args.request),
  ]);
  if (!canManageChapter(user, chapter.id, viewerMembership)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const locale = rawLocale === "ja" ? "ja" : "en";
  const form = await args.request.formData();
  const intent = form.get("intent");
  const targetUserId = String(form.get("userId") ?? "");
  if (!targetUserId) return { error: t("errors.missingUser") };

  if (targetUserId === user.id) {
    if (intent === "demote") return { error: t("errors.cannotSelfDemote") };
    if (intent === "remove") return { error: t("errors.cannotSelfRemove") };
  }

  const target = await getMembership(env.DB, targetUserId, chapter.id);
  if (!target) return { error: t("errors.userNotInChapter") };

  switch (intent) {
    case "approve": {
      await approveMembership(env.DB, targetUserId, chapter.id);
      await bustChaptersWithCountsCache();
      const targetUser = await getUserById(env.DB, targetUserId);
      if (targetUser?.email) {
        sendJoinRequestApproved(
          { env, ctx: args.context.cloudflare.ctx, locale },
          { chapter, userEmail: targetUser.email },
        );
      }
      return null;
    }
    case "promote":
      await setRole(env.DB, targetUserId, "organizer", chapter.id);
      return null;
    case "demote": {
      const outcome = await demoteMembershipUnlessLastOrganizer(env.DB, targetUserId, chapter.id);
      if (outcome === "last_active_organizer") return { error: t("errors.lastOrganizer") };
      if (outcome === "not_found") return { error: t("errors.userNotInChapter") };
      return null;
    }
    case "remove": {
      const wasPending = target.status === "pending";
      const targetUser = wasPending ? await getUserById(env.DB, targetUserId) : null;
      const outcome = await removeMembershipUnlessLastOrganizer(env.DB, targetUserId, chapter.id);
      if (outcome === "last_active_organizer") return { error: t("errors.lastOrganizer") };
      if (outcome === "not_found") return { error: t("errors.userNotInChapter") };
      await bustChaptersWithCountsCache();
      if (wasPending && targetUser?.email) {
        sendJoinRequestRejected(
          { env, ctx: args.context.cloudflare.ctx, locale },
          { chapter, userEmail: targetUser.email },
        );
      }
      return null;
    }
    default:
      return { error: t("errors.unknownAction") };
  }
}
