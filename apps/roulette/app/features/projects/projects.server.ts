import type { Mode, Prize } from "~/features/prizes/prize";
import type { Project, ProjectSummary } from "./project";

/**
 * D1 access for projects and their prize settings. Auth tables (`user`,
 * `oidc_session`) are owned by gdg-lib; spins live in draw.server.ts.
 *
 * The mode is not stored as such. `project.method` holds how odds are counted
 * — 'fixed' (custom) or 'box' (standard) — and a 'box' project is evil when
 * any of its prizes is excluded. 'equal' is no longer offered.
 */

type StoredMethod = "fixed" | "box" | "equal";

type ProjectRow = {
  slug: string;
  name: string;
  chapter_id: number;
  chapter_slug: string;
  is_open: number;
  method: StoredMethod;
  expected: number;
  draws: number;
  revision: number;
  updated_at: number;
};

type PrizeRow = {
  id: string;
  name: string;
  stock: number | null;
  won: number;
  percent: number;
  excluded: number;
};

const PROJECT_COLS =
  "slug, name, chapter_id, chapter_slug, is_open, method, expected, draws, revision, updated_at";

function toPrize(row: PrizeRow): Prize {
  return { ...row, excluded: row.excluded === 1 };
}

function modeOf(method: StoredMethod, prizes: Prize[]): Mode {
  if (method === "fixed") return "custom";
  return prizes.some((prize) => prize.excluded) ? "evil" : "standard";
}

function methodOf(mode: Mode): StoredMethod {
  return mode === "custom" ? "fixed" : "box";
}

function toProject(row: ProjectRow, prizes: Prize[]): Project {
  return {
    slug: row.slug,
    name: row.name,
    chapterId: row.chapter_id,
    chapterSlug: row.chapter_slug,
    open: row.is_open === 1,
    mode: modeOf(row.method, prizes),
    expected: row.expected,
    draws: row.draws,
    revision: row.revision,
    updatedAt: row.updated_at,
    prizes,
  };
}

export async function getProject(db: D1Database, slug: string): Promise<Project | null> {
  const [project, prizes] = await db.batch([
    db.prepare(`SELECT ${PROJECT_COLS} FROM project WHERE slug = ?`).bind(slug),
    db
      .prepare(
        `SELECT id, name, stock, won, percent, excluded FROM prize
         WHERE project_slug = ? ORDER BY position`,
      )
      .bind(slug),
  ]);
  const row = project?.results[0] as ProjectRow | undefined;
  if (!row) return null;
  return toProject(row, ((prizes?.results ?? []) as PrizeRow[]).map(toPrize));
}

export async function listProjectsForChapters(
  db: D1Database,
  chapterIds: number[],
): Promise<ProjectSummary[]> {
  if (chapterIds.length === 0) return [];
  const placeholders = chapterIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${PROJECT_COLS.split(", ")
        .map((col) => `p.${col}`)
        .join(", ")},
         (SELECT COUNT(*) FROM prize WHERE prize.project_slug = p.slug) AS prize_count
       FROM project p
       WHERE p.chapter_id IN (${placeholders})
       ORDER BY p.created_at DESC`,
    )
    .bind(...chapterIds)
    .all<ProjectRow & { prize_count: number }>();
  return (results ?? []).map((row) => {
    const { prizes: _, mode: __, ...project } = toProject(row, []);
    return { ...project, prizeCount: row.prize_count };
  });
}

export type CreateProjectInput = {
  slug: string;
  name: string;
  chapterId: number;
  chapterSlug: string;
  createdBy: string | null;
};

/** Create a project that starts closed, in the standard mode, with a single losing slot. */
export async function createProject(
  db: D1Database,
  input: CreateProjectInput,
): Promise<{ ok: true } | { ok: false; reason: "slug_taken" }> {
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO project (slug, name, chapter_id, chapter_slug, method, created_by)
           VALUES (?, ?, ?, ?, 'box', ?)`,
        )
        .bind(input.slug, input.name, input.chapterId, input.chapterSlug, input.createdBy),
      db
        .prepare(
          `INSERT INTO prize (id, project_slug, position, name, stock, percent)
           VALUES (?, ?, 0, 'ハズレ', NULL, 100)`,
        )
        .bind(crypto.randomUUID(), input.slug),
    ]);
  } catch (err) {
    if (err instanceof Error && /UNIQUE|PRIMARY KEY|constraint/i.test(err.message))
      return { ok: false, reason: "slug_taken" };
    throw err;
  }
  return { ok: true };
}

export async function setOpen(db: D1Database, slug: string, open: boolean) {
  await db
    .prepare("UPDATE project SET is_open = ? WHERE slug = ?")
    .bind(open ? 1 : 0, slug)
    .run();
}

/**
 * Replace the prize settings. Prizes keep their id (and so what they have
 * won); new ids are inserted, missing ones deleted. Fails as a whole when a
 * concurrent spin pushed `won` past a lowered stock (the prize CHECK).
 */
export async function saveSettings(
  db: D1Database,
  project: Project,
  settings: { mode: Mode; expected: number; prizes: Prize[] },
): Promise<{ ok: true } | { ok: false; reason: "conflict" }> {
  const existing = new Set(project.prizes.map((prize) => prize.id));
  const kept = settings.prizes.filter((prize) => existing.has(prize.id)).map((prize) => prize.id);
  const statements = [
    db
      .prepare(
        `DELETE FROM prize WHERE project_slug = ?
         AND id NOT IN (SELECT value FROM json_each(?))`,
      )
      .bind(project.slug, JSON.stringify(kept)),
    ...settings.prizes.map((prize, position) =>
      existing.has(prize.id)
        ? db
            .prepare(
              `UPDATE prize SET position = ?, name = ?, stock = ?, percent = ?, excluded = ?
               WHERE id = ? AND project_slug = ?`,
            )
            .bind(
              position,
              prize.name,
              prize.stock,
              prize.percent,
              prize.excluded ? 1 : 0,
              prize.id,
              project.slug,
            )
        : db
            .prepare(
              `INSERT INTO prize (id, project_slug, position, name, stock, percent, excluded)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              prize.id,
              project.slug,
              position,
              prize.name,
              prize.stock,
              prize.percent,
              prize.excluded ? 1 : 0,
            ),
    ),
    db
      .prepare(
        `UPDATE project SET method = ?, expected = ?, revision = revision + 1,
         updated_at = unixepoch() WHERE slug = ?`,
      )
      .bind(methodOf(settings.mode), settings.expected, project.slug),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    if (err instanceof Error && /constraint/i.test(err.message))
      return { ok: false, reason: "conflict" };
    throw err;
  }
  return { ok: true };
}

/** Clear every spin and its log: counters back to 0 and devices may spin again. Settings stay. */
export async function resetDraws(db: D1Database, slug: string) {
  await db.batch([
    db.prepare("DELETE FROM draw WHERE project_slug = ?").bind(slug),
    db.prepare("UPDATE prize SET won = 0 WHERE project_slug = ?").bind(slug),
    db.prepare("UPDATE project SET draws = 0 WHERE slug = ?").bind(slug),
  ]);
}
