import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import type { ChapterState } from "~/features/chapters/chapters-shared";
import {
  bustChaptersWithCountsCache,
  getChapterById,
  listChaptersWithCountsCached,
} from "~/features/chapters/repository.server";
import {
  removeOwnMembershipUnlessLastOrganizer,
  requestMembership,
} from "~/features/memberships/mutations.server";
import {
  getMembership,
  getOrganizerEmailsForChapter,
  listMembershipsForUser,
} from "~/features/memberships/repository.server";
import { sendJoinRequestSubmitted, sendMemberLeft } from "~/features/notifications/email.server";
import { getUserById } from "~/features/users/repository.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";

export async function loadChapters(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const [t, userResult] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (u) => ({ ok: true as const, user: u }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  const [chapters, memberships] = await Promise.all([
    listChaptersWithCountsCached(env.DB),
    listMembershipsForUser(env.DB, user.id),
  ]);
  const byChapterId = new Map(memberships.map((m) => [m.chapterId, m]));
  const items = chapters.map((c) => {
    const m = byChapterId.get(c.id);
    let state: ChapterState = "joinable";
    if (m?.status === "pending") state = "pending";
    else if (m?.status === "active")
      state = m.role === "organizer" ? "active-organizer" : "active-member";
    return { chapter: c, state };
  });
  return { user, items, title: t("meta.chapters") };
}

export async function actOnChapters(args: RouteRequestArgs) {
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
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  const chapterId = Number(form.get("chapterId"));
  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    return { error: t("errors.selectChapter") };
  }

  if (intent === "request") {
    const result = await requestMembership(env.DB, user.id, chapterId);
    if (!result.ok) {
      return {
        error:
          result.reason === "chapter_not_found"
            ? t("errors.chapterNotFound")
            : t("errors.alreadyInChapter"),
      };
    }
    await bustChaptersWithCountsCache();
    const chapter = await getChapterById(env.DB, chapterId);
    if (chapter) {
      const organizerEmails = await getOrganizerEmailsForChapter(env.DB, chapterId);
      sendJoinRequestSubmitted(
        { env, ctx: args.context.cloudflare.ctx, locale },
        {
          chapter,
          requester: {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            isAdmin: user.isAdmin,
          },
          organizerEmails,
        },
      );
    }
    return { ok: true, intent: "request" as const };
  }

  if (intent === "leave") {
    const chapter = await getChapterById(env.DB, chapterId);
    if (!chapter) return { error: t("errors.chapterNotFound") };
    const mine = await getMembership(env.DB, user.id, chapterId);
    if (!mine) return { error: t("errors.notInChapter") };
    const wasActive = mine.status === "active";
    const outcome = await removeOwnMembershipUnlessLastOrganizer(env.DB, user.id, chapterId);
    if (outcome === "not_found") return { error: t("errors.notInChapter") };
    if (outcome === "last_active_organizer") return { error: t("errors.lastOrganizer") };
    await bustChaptersWithCountsCache();
    if (wasActive) {
      const organizerEmails = await getOrganizerEmailsForChapter(env.DB, chapterId);
      const formerMember = (await getUserById(env.DB, user.id)) ?? {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        isAdmin: user.isAdmin,
      };
      sendMemberLeft(
        { env, ctx: args.context.cloudflare.ctx, locale },
        { chapter, formerMember, organizerEmails },
      );
    }
    return { ok: true, intent: "leave" as const };
  }

  return { error: t("errors.unknownAction") };
}
