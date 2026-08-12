import { createCookie } from "react-router";

export const ONBOARDING_SKIP_COOKIE = "accounts_onboarding_skip";

/**
 * Session-scoped skip so "later" does not force the wizard again until the
 * browser session ends. Next login with zero memberships re-prompts.
 */
export const onboardingSkipCookie = createCookie(ONBOARDING_SKIP_COOKIE, {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: import.meta.env.PROD,
});

export async function hasOnboardingSkip(request: Request): Promise<boolean> {
  const value = await onboardingSkipCookie.parse(request.headers.get("Cookie"));
  return value === "1";
}

export async function serializeOnboardingSkip(): Promise<string> {
  return onboardingSkipCookie.serialize("1");
}

export async function clearOnboardingSkip(): Promise<string> {
  return onboardingSkipCookie.serialize("", { maxAge: 0 });
}
