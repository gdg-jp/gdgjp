import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { getSessionUser } from "~/features/auth/auth.server";
import { bustChaptersWithCountsCache } from "~/features/chapters/repository.server";
import { joinMembershipViaInvite } from "~/features/memberships/mutations.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
import { inviteState } from "./invite-policy";
import { getInviteByToken } from "./repository.server";
import type { InviteJoinOutcome } from "./types";

/**
 * `/invite/:token`: validates the link before asking anyone to sign in, then
 * joins every linked chapter on open. Signed-out visitors return here through
 * `/signin?return_to=…`, which bypasses the zero-membership onboarding
 * redirect on `/` and `/dashboard`, so first-time users land on this result.
 */
export async function loadInviteAcceptance(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  const title = t("meta.invite");
  const token = args.params.token ?? "";
  const invite = token ? await getInviteByToken(env.DB, token) : null;
  if (!invite || invite.chapters.length === 0) {
    return { state: "invalid" as const, title };
  }
  const state = inviteState(invite, Math.floor(Date.now() / 1000));
  if (state !== "valid") return { state, title };

  const user = await getSessionUser(env, args.request);
  if (!user) throw buildSignInRedirect(args.request);

  const chapters: InviteJoinOutcome[] = [];
  for (const chapter of invite.chapters) {
    const result = await joinMembershipViaInvite(env.DB, user.id, chapter.id);
    chapters.push({ ...chapter, joined: result === "joined" });
  }
  if (chapters.some((c) => c.joined)) await bustChaptersWithCountsCache();
  return { state: "joined" as const, chapters, title };
}
