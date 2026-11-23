import type { ApplicationSkillRecord, Level, Pref } from "./types";

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

export async function setApplicationSkills(
  db: D1Database,
  applicationId: string,
  skills: readonly SkillInput[],
): Promise<void> {
  await db.batch(applicationSkillReplacementStatements(db, applicationId, skills));
}
