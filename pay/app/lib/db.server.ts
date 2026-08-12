import { decryptSecret, encryptSecret } from "~/lib/crypto.server";
import { newClaimId, newEventId, newItemId } from "~/lib/id";
import { sumAmounts } from "~/lib/money";

export type ProfileRow = {
  user_id: string;
  legal_name: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number_enc: string;
  updated_at: number;
};

export type EventRow = {
  id: string;
  title: string;
  owner_user_id: string;
  owner_chapter_ids: string;
  status: "open" | "closed";
  created_at: number;
};

export type ClaimRow = {
  id: string;
  event_id: string;
  kind: "self" | "proxy";
  user_id: string | null;
  applicant_name: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number_enc: string;
  application_date: string;
  total_amount: number;
  sheet_id: string | null;
  sheet_url: string | null;
  drive_folder_id: string | null;
  email_sent_at: number | null;
  status: "draft" | "synced";
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type ClaimItemRow = {
  id: string;
  claim_id: string;
  spent_on: string;
  category: string;
  description: string;
  amount_yen: number;
  receipt_r2_key: string | null;
  receipt_filename: string | null;
  receipt_content_type: string | null;
  receipt_drive_file_id: string | null;
  extraction_json: string | null;
  sort_order: number;
  created_at: number;
};

export type BankAccount = {
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
};

export type DecryptedProfile = {
  userId: string;
  legalName: string;
  bank: BankAccount;
  updatedAt: number;
};

export type PayEvent = {
  id: string;
  title: string;
  ownerUserId: string;
  ownerChapterIds: number[];
  status: "open" | "closed";
  createdAt: number;
};

export function parseOwnerChapterIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => Number.isSafeInteger(value));
  } catch {
    return [];
  }
}

export function mapEvent(row: EventRow): PayEvent {
  return {
    id: row.id,
    title: row.title,
    ownerUserId: row.owner_user_id,
    ownerChapterIds: parseOwnerChapterIds(row.owner_chapter_ids),
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function getProfile(
  db: D1Database,
  encryptionKey: string,
  userId: string,
): Promise<DecryptedProfile | null> {
  const row = await db
    .prepare("SELECT * FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<ProfileRow>();
  if (!row) return null;
  return {
    userId: row.user_id,
    legalName: row.legal_name,
    bank: {
      bankName: row.bank_name,
      branchName: row.branch_name,
      accountType: row.account_type,
      accountNumber: await decryptSecret(encryptionKey, row.account_number_enc),
    },
    updatedAt: row.updated_at,
  };
}

export async function upsertProfile(
  db: D1Database,
  encryptionKey: string,
  input: {
    userId: string;
    legalName: string;
    bank: BankAccount;
  },
): Promise<void> {
  const enc = await encryptSecret(encryptionKey, input.bank.accountNumber);
  await db
    .prepare(
      `INSERT INTO profiles (
         user_id, legal_name, bank_name, branch_name, account_type, account_number_enc, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(user_id) DO UPDATE SET
         legal_name = excluded.legal_name,
         bank_name = excluded.bank_name,
         branch_name = excluded.branch_name,
         account_type = excluded.account_type,
         account_number_enc = excluded.account_number_enc,
         updated_at = unixepoch()`,
    )
    .bind(
      input.userId,
      input.legalName,
      input.bank.bankName,
      input.bank.branchName,
      input.bank.accountType,
      enc,
    )
    .run();
}

export async function listEvents(db: D1Database): Promise<PayEvent[]> {
  const { results } = await db
    .prepare("SELECT * FROM events ORDER BY created_at DESC")
    .all<EventRow>();
  return (results ?? []).map(mapEvent);
}

export async function getEvent(db: D1Database, eventId: string): Promise<PayEvent | null> {
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  return row ? mapEvent(row) : null;
}

export async function createEvent(
  db: D1Database,
  input: { title: string; ownerUserId: string; ownerChapterIds: number[] },
): Promise<PayEvent> {
  const id = newEventId();
  await db
    .prepare(
      `INSERT INTO events (id, title, owner_user_id, owner_chapter_ids, status, created_at)
       VALUES (?, ?, ?, ?, 'open', unixepoch())`,
    )
    .bind(id, input.title, input.ownerUserId, JSON.stringify(input.ownerChapterIds))
    .run();
  const event = await getEvent(db, id);
  if (!event) throw new Error("failed to create event");
  return event;
}

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
