import type { Contact, ContactKind } from "./contact";
import type { ImportedContact } from "./wiki-import";

type ContactRow = {
  id: number;
  chapter_id: number;
  organization: string;
  kind: ContactKind;
  name: string;
  relation: string | null;
  channel: string | null;
  owner_user_id: string | null;
  wiki_person: string | null;
  wiki_path: string | null;
  synced_at: number | null;
  manual: number;
  last_used_campaign_id: number | null;
  notes: string | null;
  outcomes: string;
};

function toContact(row: ContactRow): Contact {
  let outcomes: Contact["outcomes"] = [];
  try {
    outcomes = JSON.parse(row.outcomes);
  } catch {}
  return {
    id: row.id,
    chapterId: row.chapter_id,
    organization: row.organization,
    kind: row.kind,
    name: row.name,
    relation: row.relation,
    channel: row.channel,
    ownerUserId: row.owner_user_id,
    wikiPerson: row.wiki_person || null,
    wikiPath: row.wiki_path,
    syncedAt: row.synced_at,
    manual: row.manual === 1,
    lastUsedCampaignId: row.last_used_campaign_id,
    notes: row.notes,
    outcomes,
  };
}

export async function listContacts(db: D1Database, chapterIds: number[]): Promise<Contact[]> {
  if (chapterIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT * FROM contacts WHERE chapter_id IN (${chapterIds.map(() => "?").join(",")})
       ORDER BY organization, wiki_person`,
    )
    .bind(...chapterIds)
    .all<ContactRow>();
  return results.map(toContact);
}

/**
 * Replace a chapter's Wiki-sourced rows with the page's current contents: upsert by
 * (organization, wiki person), delete rows the page no longer lists. Manual rows stay.
 * Operations columns (owner, notes, outcomes) survive a re-import.
 */
export async function syncWikiContacts(
  db: D1Database,
  chapterId: number,
  wikiPath: string,
  imported: ImportedContact[],
): Promise<{ upserted: number; removed: number }> {
  // Milliseconds: the sync marker. Rows not touched by this import are stale.
  const now = Date.now();
  const unique = new Map(imported.map((c) => [`${c.organization}\u0000${c.wikiPerson ?? ""}`, c]));
  const statements = [...unique.values()].map((c) =>
    db
      .prepare(
        `INSERT INTO contacts (chapter_id, organization, kind, name, wiki_person, wiki_path, synced_at, manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (chapter_id, organization, wiki_person) WHERE manual = 0 DO UPDATE SET
           kind = excluded.kind, name = excluded.name, wiki_path = excluded.wiki_path,
           synced_at = excluded.synced_at, updated_at = unixepoch()`,
      )
      .bind(chapterId, c.organization, c.kind, c.name, c.wikiPerson ?? "", wikiPath, now),
  );
  statements.push(
    db
      .prepare(
        "DELETE FROM contacts WHERE chapter_id = ? AND manual = 0 AND (synced_at IS NULL OR synced_at != ?)",
      )
      .bind(chapterId, now),
  );
  const results = await db.batch(statements);
  return { upserted: unique.size, removed: results.at(-1)?.meta.changes ?? 0 };
}

export async function createManualContact(
  db: D1Database,
  input: {
    chapterId: number;
    organization: string;
    kind: ContactKind;
    name: string;
    relation: string | null;
    channel: string | null;
    notes: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contacts (chapter_id, organization, kind, name, relation, channel, notes, manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(
      input.chapterId,
      input.organization,
      input.kind,
      input.name,
      input.relation,
      input.channel,
      input.notes,
    )
    .run();
}

export async function updateContact(
  db: D1Database,
  chapterIds: number[],
  id: number,
  patch: { ownerUserId?: string | null; notes?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE contacts SET owner_user_id = COALESCE(?, owner_user_id), notes = COALESCE(?, notes), updated_at = unixepoch()
       WHERE id = ? AND chapter_id IN (${chapterIds.map(() => "?").join(",")})`,
    )
    .bind(patch.ownerUserId ?? null, patch.notes ?? null, id, ...chapterIds)
    .run();
}

export async function deleteManualContact(
  db: D1Database,
  chapterIds: number[],
  id: number,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM contacts WHERE id = ? AND manual = 1 AND chapter_id IN (${chapterIds.map(() => "?").join(",")})`,
    )
    .bind(id, ...chapterIds)
    .run();
}

export async function appendOutcome(
  db: D1Database,
  id: number,
  outcome: { campaignId: number; outcome: string; note?: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE contacts SET outcomes = json_insert(outcomes, '$[#]', json(?)), last_used_campaign_id = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .bind(JSON.stringify({ ...outcome, at: Math.floor(Date.now() / 1000) }), outcome.campaignId, id)
    .run();
}
