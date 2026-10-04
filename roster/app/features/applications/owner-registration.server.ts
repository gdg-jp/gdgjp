import { applicationUniqueViolationReason } from "./applications.server";
import type { AvailabilityInput } from "./availability.server";
import { buildEventAvailabilityStatements } from "./event-availability.server";
import {
  type SkillInput,
  applicationLiveSkillReplacementStatements,
  applicationSkillReplacementStatements,
} from "./skills.server";
import type { PartyStatus } from "./types";

export type OwnerRegistrationInput = {
  eventId: string;
  existingApplicationId?: string;
  expectedUserId: string | null;
  email: string;
  name: string;
  contact: string | null;
  party: PartyStatus;
  note: string | null;
  skills: readonly SkillInput[];
  /** Correction replaces visible roles only; archived-sheet role rows survive. */
  liveRoleIds?: readonly string[];
  availability: readonly AvailabilityInput[];
};

export type OwnerRegistrationResult =
  | { ok: true; applicationId: string }
  | { ok: false; reason: "duplicate_email" | "duplicate_user" };

/**
 * Saves owner correction or proxy registration as one D1 transaction. The
 * live event slot-set and the expected email are checked inside the same
 * batch as profile, skill, and availability writes, so races roll everything
 * back and a changed proxy identity cannot receive this submission.
 */
export async function saveOwnerRegistration(
  db: D1Database,
  input: OwnerRegistrationInput,
): Promise<OwnerRegistrationResult> {
  const applicationId = input.existingApplicationId ?? crypto.randomUUID();
  const email = input.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const profileWrite = input.existingApplicationId
    ? db
        .prepare(`UPDATE applications
          SET name = ?, contact = ?, party = ?, note = ?, withdrawn = 0,
              updated_by = 'owner', updated_at = ?
          WHERE id = ? AND event_id = ? AND email = ? AND user_id IS ?`)
        .bind(
          input.name,
          input.contact,
          input.party,
          input.note,
          now,
          applicationId,
          input.eventId,
          email,
          input.expectedUserId,
        )
    : db
        .prepare(`INSERT INTO applications
          (id, event_id, user_id, email, name, contact, party, note, updated_by, created_at, updated_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'owner', ?, ?)`)
        .bind(
          applicationId,
          input.eventId,
          email,
          input.name,
          input.contact,
          input.party,
          input.note,
          now,
          now,
        );

  try {
    const skillStatements =
      input.existingApplicationId && input.liveRoleIds
        ? applicationLiveSkillReplacementStatements(
            db,
            applicationId,
            input.liveRoleIds,
            input.skills,
          )
        : applicationSkillReplacementStatements(db, applicationId, input.skills);
    await db.batch([
      profileWrite,
      ...skillStatements,
      ...buildEventAvailabilityStatements(
        db,
        input.eventId,
        applicationId,
        input.availability,
        input.expectedUserId,
        email,
      ),
    ]);
  } catch (error) {
    const reason = applicationUniqueViolationReason(error);
    if (reason) return { ok: false, reason };
    throw error;
  }

  return { ok: true, applicationId };
}
