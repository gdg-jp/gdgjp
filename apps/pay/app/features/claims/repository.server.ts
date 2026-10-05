import { decryptSecret, encryptSecret } from "~/lib/crypto.server";
import { newClaimId, newItemId } from "~/lib/id";
import type { BankAccount } from "../profiles/types";
import { sumAmounts } from "./money";
import type { ClaimItemRow, ClaimRow } from "./types";

export async function listClaimsForEvent(db: D1Database, eventId: string): Promise<ClaimRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM claims WHERE event_id = ? ORDER BY created_at ASC")
    .bind(eventId)
    .all<ClaimRow>();
  return results ?? [];
}

export async function getClaim(db: D1Database, claimId: string): Promise<ClaimRow | null> {
  return db.prepare("SELECT * FROM claims WHERE id = ?").bind(claimId).first<ClaimRow>();
}

export async function getSelfClaim(
  db: D1Database,
  eventId: string,
  userId: string,
): Promise<ClaimRow | null> {
  return db
    .prepare("SELECT * FROM claims WHERE event_id = ? AND user_id = ? AND kind = 'self'")
    .bind(eventId, userId)
    .first<ClaimRow>();
}

export async function createClaim(
  db: D1Database,
  encryptionKey: string,
  input: {
    eventId: string;
    kind: "self" | "proxy";
    userId: string | null;
    applicantName: string;
    bank: BankAccount;
    applicationDate: string;
    createdBy: string;
  },
): Promise<ClaimRow> {
  const id = newClaimId();
  const enc = await encryptSecret(encryptionKey, input.bank.accountNumber);
  await db
    .prepare(
      `INSERT INTO claims (
         id, event_id, kind, user_id, applicant_name, bank_name, branch_name, account_type,
         account_number_enc, application_date, total_amount, status, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, unixepoch(), unixepoch())`,
    )
    .bind(
      id,
      input.eventId,
      input.kind,
      input.userId,
      input.applicantName,
      input.bank.bankName,
      input.bank.branchName,
      input.bank.accountType,
      enc,
      input.applicationDate,
      input.createdBy,
    )
    .run();
  const claim = await getClaim(db, id);
  if (!claim) throw new Error("failed to create claim");
  return claim;
}

export async function updateClaimBankAndName(
  db: D1Database,
  encryptionKey: string,
  claimId: string,
  input: { applicantName: string; bank: BankAccount; applicationDate: string },
): Promise<void> {
  const enc = await encryptSecret(encryptionKey, input.bank.accountNumber);
  await db
    .prepare(
      `UPDATE claims SET
         applicant_name = ?, bank_name = ?, branch_name = ?, account_type = ?,
         account_number_enc = ?, application_date = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .bind(
      input.applicantName,
      input.bank.bankName,
      input.bank.branchName,
      input.bank.accountType,
      enc,
      input.applicationDate,
      claimId,
    )
    .run();
}

export async function listClaimItems(db: D1Database, claimId: string): Promise<ClaimItemRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM claim_items WHERE claim_id = ? ORDER BY sort_order ASC, created_at ASC")
    .bind(claimId)
    .all<ClaimItemRow>();
  return results ?? [];
}

export async function getClaimItem(db: D1Database, itemId: string): Promise<ClaimItemRow | null> {
  return db.prepare("SELECT * FROM claim_items WHERE id = ?").bind(itemId).first<ClaimItemRow>();
}

export async function insertClaimItem(
  db: D1Database,
  input: {
    claimId: string;
    spentOn: string;
    category: string;
    description: string;
    amountYen: number;
    receiptR2Key: string | null;
    receiptFilename: string | null;
    receiptContentType: string | null;
    extractionJson: string | null;
    sortOrder: number;
  },
): Promise<ClaimItemRow> {
  const id = newItemId();
  await db
    .prepare(
      `INSERT INTO claim_items (
         id, claim_id, spent_on, category, description, amount_yen,
         receipt_r2_key, receipt_filename, receipt_content_type, extraction_json, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    )
    .bind(
      id,
      input.claimId,
      input.spentOn,
      input.category,
      input.description,
      input.amountYen,
      input.receiptR2Key,
      input.receiptFilename,
      input.receiptContentType,
      input.extractionJson,
      input.sortOrder,
    )
    .run();
  const item = await getClaimItem(db, id);
  if (!item) throw new Error("failed to create claim item");
  return item;
}

export async function updateClaimItem(
  db: D1Database,
  itemId: string,
  input: {
    spentOn: string;
    category: string;
    description: string;
    amountYen: number;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE claim_items SET
         spent_on = ?, category = ?, description = ?, amount_yen = ?
       WHERE id = ?`,
    )
    .bind(input.spentOn, input.category, input.description, input.amountYen, itemId)
    .run();
}

export async function deleteClaimItem(db: D1Database, itemId: string): Promise<void> {
  await db.prepare("DELETE FROM claim_items WHERE id = ?").bind(itemId).run();
}

export async function recalculateClaimTotal(db: D1Database, claimId: string): Promise<number> {
  const items = await listClaimItems(db, claimId);
  const total = sumAmounts(items.map((item) => item.amount_yen));
  await db
    .prepare("UPDATE claims SET total_amount = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(total, claimId)
    .run();
  return total;
}

export async function markClaimSynced(
  db: D1Database,
  claimId: string,
  sheet: { sheetId: string; sheetUrl: string; driveFolderId: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE claims SET
         sheet_id = ?, sheet_url = ?, drive_folder_id = ?, status = 'synced', updated_at = unixepoch()
       WHERE id = ?`,
    )
    .bind(sheet.sheetId, sheet.sheetUrl, sheet.driveFolderId, claimId)
    .run();
}

export async function markClaimEmailSent(db: D1Database, claimId: string): Promise<void> {
  await db
    .prepare("UPDATE claims SET email_sent_at = unixepoch(), updated_at = unixepoch() WHERE id = ?")
    .bind(claimId)
    .run();
}

export async function updateItemDriveFileId(
  db: D1Database,
  itemId: string,
  driveFileId: string,
): Promise<void> {
  await db
    .prepare("UPDATE claim_items SET receipt_drive_file_id = ? WHERE id = ?")
    .bind(driveFileId, itemId)
    .run();
}

export async function decryptClaimBank(
  encryptionKey: string,
  claim: ClaimRow,
): Promise<BankAccount> {
  return {
    bankName: claim.bank_name,
    branchName: claim.branch_name,
    accountType: claim.account_type,
    accountNumber: await decryptSecret(encryptionKey, claim.account_number_enc),
  };
}

export function eventTotal(claims: ClaimRow[]): number {
  return sumAmounts(claims.map((claim) => claim.total_amount));
}
