import { nowIso } from "~/lib/utils";
import { listXAccounts, revokeXAccountRow } from "./x-account.repository.server";
import type { XAccountDependencies, XAccountSummary } from "./x-account.types";

export class XAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XAccountError";
  }
}

/**
 * The active (non-revoked) X accounts a chapter can post from, projected to
 * identity/metadata only — the encrypted tokens never leave the repository.
 */
export async function listUsableXAccounts(
  deps: XAccountDependencies,
  chapterId: number,
): Promise<XAccountSummary[]> {
  const accounts = await listXAccounts(deps.db, chapterId);
  return accounts.map((account) => ({
    id: account.id,
    chapterId: account.chapterId,
    xUserId: account.xUserId,
    username: account.username,
    displayName: account.displayName,
    profileImageUrl: account.profileImageUrl,
    authorizedByUserId: account.authorizedByUserId,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    revokedAt: account.revokedAt,
  }));
}

/**
 * Soft-revokes an account after confirming both its chapter and its X user id.
 * The row is kept (published posts still reference it); only `revoked_at` is
 * set. A confirmation that does not match exactly is rejected.
 */
export async function revokeXAccount(
  deps: XAccountDependencies,
  accountId: string,
  chapterId: number,
  expectedXUserId: string,
): Promise<void> {
  const changes = await revokeXAccountRow(deps.db, {
    accountId,
    chapterId,
    xUserId: expectedXUserId,
    now: nowIso(),
  });
  if (changes !== 1) throw new XAccountError("X Account ID confirmation does not match");
}
