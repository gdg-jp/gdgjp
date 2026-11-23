import { nowIso } from "~/lib/utils";
import { listXAccounts, revokeXAccountRow } from "./x-account.repository.server";
import type { XAccountDependencies, XAccountSummary } from "./x-account.types";

export class XAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XAccountError";
  }
}

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
