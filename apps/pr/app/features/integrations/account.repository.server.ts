import type { AccountKind, CampaignAccount } from "./account";

type Row = {
  id: number;
  campaign_id: number;
  kind: AccountKind;
  chapter_id: number;
  external_id: string;
  label: string;
  role: "primary" | "mirror";
};

const toAccount = (r: Row): CampaignAccount => ({
  id: r.id,
  campaignId: r.campaign_id,
  kind: r.kind,
  chapterId: r.chapter_id,
  externalId: r.external_id,
  label: r.label,
  role: r.role,
});

export async function listAccounts(
  db: D1Database,
  campaignId: number,
  kind?: AccountKind,
): Promise<CampaignAccount[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM campaign_accounts WHERE campaign_id = ? ${kind ? "AND kind = ?" : ""}
       ORDER BY role = 'primary' DESC, id`,
    )
    .bind(...(kind ? [campaignId, kind] : [campaignId]))
    .all<Row>();
  return results.map(toAccount);
}

export async function getAccount(db: D1Database, id: number): Promise<CampaignAccount | null> {
  const row = await db
    .prepare("SELECT * FROM campaign_accounts WHERE id = ?")
    .bind(id)
    .first<Row>();
  return row ? toAccount(row) : null;
}

export async function addAccount(
  db: D1Database,
  input: Omit<CampaignAccount, "id">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO campaign_accounts (campaign_id, kind, chapter_id, external_id, label, role)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (campaign_id, kind, external_id) DO UPDATE SET label = excluded.label, role = excluded.role`,
    )
    .bind(input.campaignId, input.kind, input.chapterId, input.externalId, input.label, input.role)
    .run();
}

export async function removeAccount(db: D1Database, campaignId: number, id: number): Promise<void> {
  await db
    .prepare("DELETE FROM campaign_accounts WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .run();
}
