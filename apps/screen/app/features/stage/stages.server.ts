import type { StageMeta } from "./protocol";

export type StageRow = {
  id: string;
  name: string;
  slotCount: number;
  outputToken: string;
  createdAt: number;
};

type DbRow = {
  id: string;
  name: string;
  slot_count: number;
  output_token: string;
  created_at: number;
};

const COLUMNS = "id, name, slot_count, output_token, created_at";

function toStage(row: DbRow): StageRow {
  return {
    id: row.id,
    name: row.name,
    slotCount: row.slot_count,
    outputToken: row.output_token,
    createdAt: row.created_at,
  };
}

export function metaOf(stage: StageRow): StageMeta {
  return { id: stage.id, name: stage.name, slotCount: stage.slotCount };
}

/** URL-safe random token (base64url, 24 bytes). */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function clampSlotCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.min(4, Math.max(1, Math.round(n))) : 2;
}

export async function listStages(db: D1Database): Promise<StageRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM stage ORDER BY created_at ASC`)
    .all<DbRow>();
  return results.map(toStage);
}

export async function getStage(db: D1Database, id: string): Promise<StageRow | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM stage WHERE id = ?`).bind(id).first<DbRow>();
  return row ? toStage(row) : null;
}

/** Inserts a stage under the operator's id; null when that id is already taken. */
export async function createStage(
  db: D1Database,
  input: { id: string; name: string; slotCount: number; createdBy: string },
): Promise<StageRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const stage: StageRow = {
    id: input.id,
    name: input.name,
    slotCount: clampSlotCount(input.slotCount),
    outputToken: randomToken(),
    createdAt: now,
  };
  const res = await db
    .prepare(
      `INSERT INTO stage (id, name, slot_count, output_token, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(stage.id, stage.name, stage.slotCount, stage.outputToken, input.createdBy, now, now)
    .run();
  return res.meta.changes === 1 ? stage : null;
}

export async function renameStage(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare("UPDATE stage SET name = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(name, id)
    .run();
}

/** New OBS token; the old OBS URLs stop working. */
export async function rotateOutputToken(db: D1Database, id: string): Promise<string> {
  const token = randomToken();
  await db
    .prepare("UPDATE stage SET output_token = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(token, id)
    .run();
  return token;
}

export async function deleteStage(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM stage WHERE id = ?").bind(id).run();
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
