import { type DeckLayout, MAX_LAYOUT_BYTES, emptyLayout, newId, parseLayout } from "./model";

export type DeckRow = {
  id: string;
  chapterId: number;
  name: string;
  layout: DeckLayout;
  version: number;
  dockToken: string;
  createdAt: number;
};

type DbRow = {
  id: string;
  chapter_id: number;
  name: string;
  layout: string;
  version: number;
  dock_token: string;
  created_at: number;
};

const COLUMNS = "id, chapter_id, name, layout, version, dock_token, created_at";

function toDeck(row: DbRow): DeckRow {
  let layout: DeckLayout | null = null;
  try {
    layout = parseLayout(JSON.parse(row.layout));
  } catch {
    layout = null;
  }
  return {
    id: row.id,
    chapterId: row.chapter_id,
    name: row.name,
    layout: layout ?? emptyLayout(),
    version: row.version,
    dockToken: row.dock_token,
    createdAt: row.created_at,
  };
}

const DECK_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function isDeckId(value: unknown): value is string {
  return typeof value === "string" && DECK_ID_RE.test(value);
}

/** URL-safe random token (base64url, 24 bytes). */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function listDecks(db: D1Database, chapterIds: number[]): Promise<DeckRow[]> {
  if (chapterIds.length === 0) return [];
  const marks = chapterIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM deck WHERE chapter_id IN (${marks}) ORDER BY created_at ASC`)
    .bind(...chapterIds)
    .all<DbRow>();
  return results.map(toDeck);
}

export async function getDeck(db: D1Database, id: string): Promise<DeckRow | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM deck WHERE id = ?`).bind(id).first<DbRow>();
  return row ? toDeck(row) : null;
}

export async function createDeck(
  db: D1Database,
  input: { chapterId: number; name: string; layout: DeckLayout; createdBy: string },
): Promise<DeckRow> {
  const now = Math.floor(Date.now() / 1000);
  const deck: DeckRow = {
    id: newId() + newId().slice(0, 4),
    chapterId: input.chapterId,
    name: input.name,
    layout: input.layout,
    version: 1,
    dockToken: randomToken(),
    createdAt: now,
  };
  await db
    .prepare(
      `INSERT INTO deck (id, chapter_id, name, layout, version, dock_token, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      deck.id,
      deck.chapterId,
      deck.name,
      JSON.stringify(deck.layout),
      deck.dockToken,
      input.createdBy,
      now,
      now,
    )
    .run();
  return deck;
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; error: "conflict" | "too-large" };

/** Saves the whole layout if nobody saved since `baseVersion`. */
export async function saveLayout(
  db: D1Database,
  id: string,
  baseVersion: number,
  layout: DeckLayout,
): Promise<SaveResult> {
  const json = JSON.stringify(layout);
  if (new TextEncoder().encode(json).byteLength > MAX_LAYOUT_BYTES) {
    return { ok: false, error: "too-large" };
  }
  const res = await db
    .prepare(
      `UPDATE deck SET layout = ?, version = version + 1, updated_at = unixepoch()
       WHERE id = ? AND version = ?`,
    )
    .bind(json, id, baseVersion)
    .run();
  if (res.meta.changes !== 1) return { ok: false, error: "conflict" };
  return { ok: true, version: baseVersion + 1 };
}

/** Renames without bumping the layout version (an open editor's draft stays saveable). */
export async function renameDeck(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare("UPDATE deck SET name = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(name, id)
    .run();
}

/** New dock token; the old dock URL stops working. */
export async function rotateDockToken(db: D1Database, id: string): Promise<string> {
  const token = randomToken();
  await db
    .prepare("UPDATE deck SET dock_token = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(token, id)
    .run();
  return token;
}

export async function deleteDeck(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM deck_image WHERE deck_id = ?").bind(id),
    db.prepare("DELETE FROM deck WHERE id = ?").bind(id),
  ]);
}
