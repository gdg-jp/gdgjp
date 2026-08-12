import { redirect } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { listMembershipsForUser } from "~/lib/db";
import { shouldStartChapterOnboarding } from "~/lib/onboarding-policy";
import { hasOnboardingSkip } from "~/lib/onboarding-skip.server";
import type { Route } from "./+types/home";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSessionUser(context.cloudflare.env, request);
  if (!session) throw redirect("/signin");
  const [memberships, skipped] = await Promise.all([
    listMembershipsForUser(context.cloudflare.env.DB, session.id),
    hasOnboardingSkip(request),
  ]);
  if (shouldStartChapterOnboarding(memberships.length, skipped)) {
    throw redirect("/onboarding");
  }
  throw redirect("/dashboard");
}

/** @deprecated Prefer loader; kept for unit tests of the unauthenticated branch. */
export function homeRedirect(isAuthenticated: boolean): "/dashboard" | "/signin" {
  return isAuthenticated ? "/dashboard" : "/signin";
}

export default function Home() {
  return null;
}
