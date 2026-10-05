import type { AuthUser } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { listMembershipsForUser } from "~/features/memberships/repository.server";
import { shouldStartChapterOnboarding } from "~/features/onboarding/onboarding-policy";
import { hasOnboardingSkip } from "~/features/onboarding/onboarding-skip.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadDashboard(args: RouteRequestArgs) {
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
  const [memberships, skipped] = await Promise.all([
    listMembershipsForUser(env.DB, user.id),
    hasOnboardingSkip(args.request),
  ]);
  if (shouldStartChapterOnboarding(memberships.length, skipped)) {
    throw redirect("/onboarding");
  }
  return { user, memberships, title: t("meta.dashboard") };
}
