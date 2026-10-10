import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { listMembershipsForUser } from "~/features/memberships/repository.server";
import { randomToken } from "~/lib/crypto.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
import { invitableChapterIds, inviteUrl, parseExpiryDays } from "./invite-policy";
import {
  createInvite,
  getInviteById,
  listActiveInvitesForChapters,
  revokeInvite,
} from "./repository.server";

const DAY_SECONDS = 24 * 60 * 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function resolveOrganizer(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  let user: AuthUser;
  try {
    user = await requireUser(env, args.request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw error;
  }
  const memberships = await listMembershipsForUser(env.DB, user.id);
  const organizerIds = new Set(invitableChapterIds(memberships));
  if (organizerIds.size === 0) throw new Response("Forbidden", { status: 403 });
  const chapters = memberships
    .filter((m) => organizerIds.has(m.chapterId))
    .map(({ chapter: { id, slug, name } }) => ({ id, slug, name }));
  return { env, user, organizerIds, chapters };
}

export async function loadInvites(args: RouteRequestArgs) {
  const { env, user, organizerIds, chapters } = await resolveOrganizer(args);
  const [t, invites] = await Promise.all([
    i18n.getFixedT(args.request),
    listActiveInvitesForChapters(env.DB, [...organizerIds], nowSeconds()),
  ]);
  const preselect = new URL(args.request.url).searchParams.get("chapter");
  return {
    user,
    chapters,
    preselectedChapterId: chapters.find((c) => c.slug === preselect)?.id ?? null,
    invites: invites.map((invite) => ({
      ...invite,
      url: inviteUrl(env.APP_URL, invite.token),
      // Linked chapters the viewer does not organize are still shown by name.
      canRevoke: invite.chapters.some((c) => organizerIds.has(c.id)),
    })),
    title: t("meta.invites"),
  };
}

export async function actOnInvites(args: RouteRequestArgs) {
  const { env, user, organizerIds } = await resolveOrganizer(args);
  const t = await i18n.getFixedT(args.request);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const chapterIds = [
      ...new Set(
        form
          .getAll("chapterId")
          .map((v) => Number(v))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (chapterIds.length === 0) return { error: t("errors.selectChapter") };
    if (!chapterIds.every((id) => organizerIds.has(id))) {
      return { error: t("invites.errors.notOrganizer") };
    }
    const days = parseExpiryDays(form.get("expiresInDays"));
    if (days === null) return { error: t("invites.errors.invalidExpiry") };
    const token = randomToken(24);
    await createInvite(env.DB, {
      id: randomToken(16),
      token,
      createdBy: user.id,
      chapterIds,
      expiresAt: nowSeconds() + days * DAY_SECONDS,
    });
    return { ok: true as const, intent: "create" as const, url: inviteUrl(env.APP_URL, token) };
  }

  if (intent === "revoke") {
    const inviteId = String(form.get("inviteId") ?? "");
    const invite = inviteId ? await getInviteById(env.DB, inviteId) : null;
    if (!invite) return { error: t("invites.errors.notFound") };
    if (!invite.chapters.some((c) => organizerIds.has(c.id))) {
      return { error: t("invites.errors.notOrganizer") };
    }
    await revokeInvite(env.DB, invite.id);
    return { ok: true as const, intent: "revoke" as const };
  }

  return { error: t("errors.unknownAction") };
}
