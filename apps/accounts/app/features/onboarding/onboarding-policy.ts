export function shouldStartChapterOnboarding(
  membershipCount: number,
  hasSkipCookie: boolean,
): boolean {
  return membershipCount === 0 && !hasSkipCookie;
}
