import { type AvailabilityInput, setAvailability } from "./availability.server";
import { type ExistingApplication, resolveApplication } from "./claim";
import { type SkillInput, setApplicationSkills } from "./skills.server";
import type { ApplicationRecord, PartyStatus, UpdatedBy } from "./types";

type ApplicationRow = {
  id: string;
  event_id: string;
  user_id: string | null;
  email: string;
  name: string;
  contact: string | null;
  party: string;
  note: string | null;
  withdrawn: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

const APPLICATION_COLS =
  "id, event_id, user_id, email, name, contact, party, note, withdrawn, updated_by, created_at, updated_at";

export function toApplication(r: ApplicationRow): ApplicationRecord {
  return {
    id: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    email: r.email,
    name: r.name,
    contact: r.contact,
    party: r.party as PartyStatus,
    note: r.note,
    withdrawn: r.withdrawn === 1,
    updatedBy: r.updated_by as UpdatedBy,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function applicationUniqueViolationReason(
  err: unknown,
): "duplicate_email" | "duplicate_user" | null {
  if (!(err instanceof Error) || !err.message.includes("UNIQUE constraint failed")) return null;
  if (err.message.includes("applications.email")) return "duplicate_email";
  if (err.message.includes("applications.user_id")) return "duplicate_user";
  return null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getApplicationById(
  db: D1Database,
  eventId: string,
  id: string,
): Promise<ApplicationRecord | null> {
  const row = await db
    .prepare(`SELECT ${APPLICATION_COLS} FROM applications WHERE id = ? AND event_id = ?`)
    .bind(id, eventId)
    .first<ApplicationRow>();
  return row ? toApplication(row) : null;
}

export async function getApplicationByEventAndEmail(
  db: D1Database,
  eventId: string,
  email: string,
): Promise<ApplicationRecord | null> {
  const row = await db
    .prepare(`SELECT ${APPLICATION_COLS} FROM applications WHERE event_id = ? AND email = ?`)
    .bind(eventId, normalizeEmail(email))
    .first<ApplicationRow>();
  return row ? toApplication(row) : null;
}

export async function listApplicationsForEvent(
  db: D1Database,
  eventId: string,
): Promise<ApplicationRecord[]> {
  const { results } = await db
    .prepare(`SELECT ${APPLICATION_COLS} FROM applications WHERE event_id = ? ORDER BY created_at`)
    .bind(eventId)
    .all<ApplicationRow>();
  return (results ?? []).map(toApplication);
}

type CandidateRow = { id: string; user_id: string | null; email: string };

async function findApplicationCandidates(
  db: D1Database,
  eventId: string,
  viewer: { userId: string; email: string },
): Promise<ExistingApplication[]> {
  const { results } = await db
    .prepare(
      "SELECT id, user_id, email FROM applications WHERE event_id = ? AND (user_id = ? OR email = ?)",
    )
    .bind(eventId, viewer.userId, normalizeEmail(viewer.email))
    .all<CandidateRow>();
  return (results ?? []).map((r) => ({ id: r.id, userId: r.user_id, email: r.email }));
}

export async function claimApplication(
  db: D1Database,
  id: string,
  userId: string,
): Promise<ApplicationRecord | null> {
  const row = await db
    .prepare(
      `UPDATE applications SET user_id = ? WHERE id = ? AND user_id IS NULL RETURNING ${APPLICATION_COLS}`,
    )
    .bind(userId, id)
    .first<ApplicationRow>();
  return row ? toApplication(row) : null;
}

export type ResolvedApplication = { kind: "own"; application: ApplicationRecord } | { kind: "new" };

export async function resolveOwnApplication(
  db: D1Database,
  eventId: string,
  viewer: { userId: string; email: string },
): Promise<ResolvedApplication> {
  const normalizedViewer = { userId: viewer.userId, email: normalizeEmail(viewer.email) };

  const resolution = resolveApplication(
    await findApplicationCandidates(db, eventId, normalizedViewer),
    normalizedViewer,
  );

  if (resolution.kind === "new") return { kind: "new" };

  if (resolution.kind === "own") {
    const application = await getApplicationById(db, eventId, resolution.id);
    return application ? { kind: "own", application } : { kind: "new" };
  }

  const claimed = await claimApplication(db, resolution.id, normalizedViewer.userId);
  if (claimed) return { kind: "own", application: claimed };

  const reResolved = resolveApplication(
    await findApplicationCandidates(db, eventId, normalizedViewer),
    normalizedViewer,
  );
  if (reResolved.kind !== "own") return { kind: "new" };
  const application = await getApplicationById(db, eventId, reResolved.id);
  return application ? { kind: "own", application } : { kind: "new" };
}

export type CreateApplicationInput = {
  userId: string | null;
  email: string;
  name: string;
  contact: string | null;
  party: PartyStatus;
  note: string | null;
  updatedBy: UpdatedBy;
};

export type CreateApplicationResult =
  | { ok: true; application: ApplicationRecord }
  | { ok: false; reason: "duplicate_email" | "duplicate_user" };

export async function createApplication(
  db: D1Database,
  eventId: string,
  input: CreateApplicationInput,
): Promise<CreateApplicationResult> {
  const now = new Date().toISOString();
  try {
    const row = await db
      .prepare(
        `INSERT INTO applications
           (id, event_id, user_id, email, name, contact, party, note, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${APPLICATION_COLS}`,
      )
      .bind(
        crypto.randomUUID(),
        eventId,
        input.userId,
        normalizeEmail(input.email),
        input.name,
        input.contact,
        input.party,
        input.note,
        input.updatedBy,
        now,
        now,
      )
      .first<ApplicationRow>();
    if (!row) throw new Error("Application insert returned no row");
    return { ok: true, application: toApplication(row) };
  } catch (err) {
    const reason = applicationUniqueViolationReason(err);
    if (reason) return { ok: false, reason };
    throw err;
  }
}

export type UpdateApplicationInput = {
  name: string;
  contact: string | null;
  party: PartyStatus;
  note: string | null;
  withdrawn: boolean;
  updatedBy: UpdatedBy;
};

export async function updateApplication(
  db: D1Database,
  id: string,
  input: UpdateApplicationInput,
): Promise<ApplicationRecord | null> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `UPDATE applications
       SET name = ?, contact = ?, party = ?, note = ?, withdrawn = ?, updated_by = ?, updated_at = ?
       WHERE id = ?
       RETURNING ${APPLICATION_COLS}`,
    )
    .bind(
      input.name,
      input.contact,
      input.party,
      input.note,
      input.withdrawn ? 1 : 0,
      input.updatedBy,
      now,
      id,
    )
    .first<ApplicationRow>();
  return row ? toApplication(row) : null;
}

export async function withdrawApplication(
  db: D1Database,
  id: string,
  updatedBy: UpdatedBy,
): Promise<ApplicationRecord | null> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `UPDATE applications SET withdrawn = 1, updated_by = ?, updated_at = ? WHERE id = ? RETURNING ${APPLICATION_COLS}`,
    )
    .bind(updatedBy, now, id)
    .first<ApplicationRow>();
  return row ? toApplication(row) : null;
}

export async function correctApplication(
  db: D1Database,
  existing: Pick<ApplicationRecord, "id" | "name" | "contact" | "party" | "note">,
  input: { skills: readonly SkillInput[]; availability: readonly AvailabilityInput[] },
): Promise<void> {
  await updateApplication(db, existing.id, {
    name: existing.name,
    contact: existing.contact,
    party: existing.party,
    note: existing.note,
    withdrawn: false,
    updatedBy: "owner",
  });
  await Promise.all([
    setApplicationSkills(db, existing.id, input.skills),
    setAvailability(db, existing.id, input.availability),
  ]);
}
