import type { StageMeta } from "./protocol";
import { generateStageId } from "./stage-id";

export type StageRow = {
  id: string;
  name: string;
  slotCount: number;
  inviteToken: string;
  outputToken: string;
  createdAt: number;
};

type DbRow = {
  id: string;
  name: string;
  slot_count: number;
  invite_token: string;
  output_token: string;
  created_at: number;
};

const COLUMNS = "id, name, slot_count, invite_token, output_token, created_at";

function toStage(row: DbRow): StageRow {
  return {
    id: row.id,
    name: row.name,
    slotCount: row.slot_count,
    inviteToken: row.invite_token,
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

export async function getStageByInvite(db: D1Database, token: string): Promise<StageRow | null> {
  if (!token) return null;
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM stage WHERE invite_token = ?`)
    .bind(token)
    .first<DbRow>();
  return row ? toStage(row) : null;
}

export async function createStage(
  db: D1Database,
  input: { id?: string; name: string; slotCount: number; createdBy: string },
): Promise<StageRow> {
  const now = Math.floor(Date.now() / 1000);
  // The proposed id is only a suggestion; on collision draw fresh ones.
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = attempt === 0 && input.id ? input.id : generateStageId();
    const stage: StageRow = {
      id,
      name: input.name,
      slotCount: clampSlotCount(input.slotCount),
      inviteToken: generateStageId(),
      outputToken: randomToken(),
      createdAt: now,
    };
    const res = await db
      .prepare(
        `INSERT INTO stage (id, name, slot_count, invite_token, output_token, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        stage.id,
        stage.name,
        stage.slotCount,
        stage.inviteToken,
        stage.outputToken,
        input.createdBy,
        now,
        now,
      )
      .run()
      .catch((err: unknown) => {
        // The invite words collided with another stage's; draw again.
        if (String(err).includes("UNIQUE")) return null;
        throw err;
      });
    if (res?.meta.changes === 1) return stage;
  }
  throw new Error("could not allocate a stage id");
}

export async function renameStage(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare("UPDATE stage SET name = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(name, id)
    .run();
}

export async function rotateToken(
  db: D1Database,
  id: string,
  kind: "invite" | "output",
): Promise<string> {
  const column = kind === "invite" ? "invite_token" : "output_token";
  for (let attempt = 0; attempt < 8; attempt++) {
    // Invite links are three words (screen.gdgs.jp/apple-banana-orange/) so
    // they can be read out loud; the OBS token stays opaque.
    const token = kind === "invite" ? generateStageId() : randomToken();
    const ok = await db
      .prepare(`UPDATE stage SET ${column} = ?, updated_at = unixepoch() WHERE id = ?`)
      .bind(token, id)
      .run()
      .then(() => true)
      .catch((err: unknown) => {
        if (String(err).includes("UNIQUE")) return false;
        throw err;
      });
    if (ok) return token;
  }
  throw new Error("could not allocate an invite id");
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
