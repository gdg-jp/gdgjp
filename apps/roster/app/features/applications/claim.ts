/**
 * Proxy-registration claim resolution (ADR-008,
 * docs/roster/04-applications.md "Design" §3 "引き取り（claim）"). Pure
 * decision function — no D1, no auth — so the priority rule can be pinned
 * with unit tests independent of how the caller loaded the candidate rows.
 *
 * `accounts` has no user-search API, so an owner can only proxy-register
 * someone by email. When that person later signs in and opens
 * `/apply/:applyToken`, the row with a matching email and no `user_id` yet
 * is theirs to claim — but only if nobody has already claimed it, and only
 * after checking `userId` first (a `user_id` link, once made, is stronger
 * than an email match because `accounts` email addresses can change).
 */

export type ExistingApplication = {
  id: string;
  userId: string | null;
  email: string;
};

export type Viewer = {
  userId: string;
  email: string;
};

export type ClaimResolution =
  | { kind: "own"; id: string }
  | { kind: "claimable"; id: string }
  | { kind: "new" };

/**
 * `existing` should be every application row for the event whose `user_id`
 * equals `viewer.userId` OR whose `email` equals `viewer.email` — the
 * caller narrows with a WHERE clause; this function only decides priority
 * among whatever it's given.
 */
export function resolveApplication(
  existing: readonly ExistingApplication[],
  viewer: Viewer,
): ClaimResolution {
  const own = existing.find((a) => a.userId === viewer.userId);
  if (own) return { kind: "own", id: own.id };

  // Only an unclaimed (`user_id IS NULL`) row is claimable — a row already
  // linked to someone else must never be claimable by this viewer, even if
  // the email happens to match (e.g. accounts email changes landing two
  // people on the same address at different times).
  const claimable = existing.find((a) => a.userId === null && a.email === viewer.email);
  if (claimable) return { kind: "claimable", id: claimable.id };

  return { kind: "new" };
}
