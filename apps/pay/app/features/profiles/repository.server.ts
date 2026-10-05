import { decryptSecret, encryptSecret } from "~/lib/crypto.server";
import type { BankAccount, DecryptedProfile, ProfileRow } from "./types";

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
