import type { ApplicationSkillRecord, Level, Pref } from "./types";

/**
 * D1 access for `application_skills` (docs/roster/index.md §4). A role the
 * applicant can't take has no row at all — there is no "unable" `pref`
 * value (docs/roster/04-applications.md "Design" §1) — so the write path is
 * delete-all-then-insert, the same wholesale-replace shape
 * `~/features/schedule/roles.server#setEventRoles` uses for a sheet's roles.
 */

type ApplicationSkillRow = {
  application_id: string;
  role_id: string;
  level: string;
  pref: number;
};

const SKILL_COLS = "application_id, role_id, level, pref";

export function toApplicationSkill(r: ApplicationSkillRow): ApplicationSkillRecord {
  return {
    applicationId: r.application_id,
    roleId: r.role_id,
    level: r.level as Level,
    pref: r.pref as Pref,
  };
}

export async function listSkillsForApplication(
  db: D1Database,
  applicationId: string,
): Promise<ApplicationSkillRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SKILL_COLS} FROM application_skills WHERE application_id = ? ORDER BY role_id`,
    )
    .bind(applicationId)
    .all<ApplicationSkillRow>();
  return (results ?? []).map(toApplicationSkill);
}

export type SkillInput = { roleId: string; level: Level; pref: Pref };

export function applicationSkillReplacementStatements(
  db: D1Database,
  applicationId: string,
  skills: readonly SkillInput[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM application_skills WHERE application_id = ?").bind(applicationId),
  ];
  for (const skill of skills) {
    statements.push(
      db
        .prepare(
          "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES (?, ?, ?, ?)",
        )
        .bind(applicationId, skill.roleId, skill.level, skill.pref),
    );
  }
  return statements;
}

/** Replaces live-role skills while retaining rows for roles on archived sheets. */
export function applicationLiveSkillReplacementStatements(
  db: D1Database,
  applicationId: string,
  liveRoleIds: readonly string[],
  skills: readonly SkillInput[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`DELETE FROM application_skills
        WHERE application_id = ?
          AND role_id IN (SELECT value FROM json_each(?))`)
      .bind(applicationId, JSON.stringify(liveRoleIds)),
  ];
  for (const skill of skills) {
    statements.push(
      db
        .prepare(
          "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES (?, ?, ?, ?)",
        )
        .bind(applicationId, skill.roleId, skill.level, skill.pref),
    );
  }
  return statements;
}

/** Replaces the application's whole skill set — never a partial merge. */
export async function setApplicationSkills(
  db: D1Database,
  applicationId: string,
  skills: readonly SkillInput[],
): Promise<void> {
  await db.batch(applicationSkillReplacementStatements(db, applicationId, skills));
}
