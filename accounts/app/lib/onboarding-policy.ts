/**
 * Pure redirect policy for chapter onboarding.
 * External OIDC return_to must not be forced through onboarding — callers
 * only apply this on accounts-owned landing routes (/, /dashboard).
 */
export function shouldStartChapterOnboarding(
  membershipCount: number,
  hasSkipCookie: boolean,
): boolean {
  return membershipCount === 0 && !hasSkipCookie;
}
