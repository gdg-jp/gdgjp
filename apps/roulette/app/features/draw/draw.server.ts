import { currentOdds, pickPrize, rankOf, tierOf } from "~/features/prizes/odds";
import type { Tier } from "~/features/prizes/prize";
import { getProject } from "~/features/projects/projects.server";
import type { DrawLogEntry } from "./log";
import { type DrawResult, formatDrawTime } from "./result";

export type SpinOutcome =
  | { status: "won"; result: DrawResult }
  | { status: "already"; result: DrawResult }
  | { status: "closed" }
  | { status: "soldout" }
  | { status: "missing" }
  | { status: "busy" };

type DrawRow = {
  prize_id: string | null;
  prize_name: string;
  rank: number | null;
  tier: Tier;
  number: number;
  created_at: number;
};

function toResult(row: DrawRow): DrawResult {
  return {
    prizeId: row.prize_id,
    name: row.prize_name,
    rank: row.rank,
    tier: row.tier,
    number: row.number,
    time: formatDrawTime(row.created_at),
  };
}

const DRAW_COLS = "prize_id, prize_name, rank, tier, number, created_at";

export async function getDeviceDraw(
  db: D1Database,
  slug: string,
  deviceId: string,
): Promise<DrawResult | null> {
  const row = await db
    .prepare(`SELECT ${DRAW_COLS} FROM draw WHERE project_slug = ? AND device_id = ?`)
    .bind(slug, deviceId)
    .first<DrawRow>();
  return row ? toResult(row) : null;
}

/** A project's spins for the admin log, latest first; every spin unless `limit` is given. */
export async function listDraws(
  db: D1Database,
  slug: string,
  limit?: number,
): Promise<DrawLogEntry[]> {
  // LIMIT -1 is no limit in SQLite.
  const { results } = await db
    .prepare(
      `SELECT number, prize_name, rank, created_at FROM draw
       WHERE project_slug = ? ORDER BY number DESC LIMIT ?`,
    )
    .bind(slug, limit ?? -1)
    .all<{ number: number; prize_name: string; rank: number | null; created_at: number }>();
  return (results ?? []).map((row) => ({
    number: row.number,
    name: row.prize_name,
    rank: row.rank,
    createdAt: row.created_at,
  }));
}

function secureRandom() {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
}

const ATTEMPTS = 4;

/**
 * Spin once for a device. The prize is picked from the current odds, then one
 * D1 batch (a transaction) records it:
 *
 *   1. count the spin, only while the project is open;
 *   2. take one of the prize, only if the spin counted and stock is left;
 *   3. insert the draw with the spin's number — NULL (a NOT NULL violation that
 *      rolls the whole batch back) unless step 2 took a prize. The unique
 *      (project, device) index rolls back a second spin from the same device.
 *
 * A rolled-back batch is re-read and retried, so a prize that ran out between
 * the read and the write is re-picked instead of handed out twice.
 */
export async function spin(
  db: D1Database,
  slug: string,
  deviceId: string,
  random: () => number = secureRandom,
): Promise<SpinOutcome> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const [project, existing] = await Promise.all([
      getProject(db, slug),
      getDeviceDraw(db, slug, deviceId),
    ]);
    if (!project) return { status: "missing" };
    if (existing) return { status: "already", result: existing };
    if (!project.open) return { status: "closed" };
    const odds = currentOdds(project.prizes, project.mode, project.expected, project.draws);
    const prizeId = pickPrize(project.prizes, odds, random);
    const prize = project.prizes.find((item) => item.id === prizeId);
    if (!prize) return { status: "soldout" };

    const id = crypto.randomUUID();
    try {
      await db.batch([
        db
          .prepare("UPDATE project SET draws = draws + 1 WHERE slug = ?1 AND is_open = 1")
          .bind(slug),
        db
          .prepare(
            `UPDATE prize SET won = won + 1
             WHERE id = ?1 AND project_slug = ?2 AND (stock IS NULL OR won < stock)
               AND changes() = 1`,
          )
          .bind(prize.id, slug),
        db
          .prepare(
            `INSERT INTO draw (id, project_slug, prize_id, prize_name, rank, tier, number, device_id)
             SELECT ?1, slug, ?2, ?3, ?4, ?5, CASE WHEN changes() = 1 THEN draws END, ?6
             FROM project WHERE slug = ?7`,
          )
          .bind(
            id,
            prize.id,
            prize.name,
            rankOf(project.prizes, prize.id),
            tierOf(project.prizes, prize.id),
            deviceId,
            slug,
          ),
      ]);
    } catch (err) {
      if (err instanceof Error && /constraint/i.test(err.message)) continue;
      throw err;
    }
    const row = await db
      .prepare(`SELECT ${DRAW_COLS} FROM draw WHERE id = ?`)
      .bind(id)
      .first<DrawRow>();
    if (!row) throw new Error("draw vanished immediately after insert");
    return { status: "won", result: toResult(row) };
  }
  return { status: "busy" };
}
