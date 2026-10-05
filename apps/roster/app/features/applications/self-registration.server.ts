import { applicationUniqueViolationReason } from "./applications.server";
import type { AvailabilityInput } from "./availability.server";
import { buildEventAvailabilityStatements } from "./event-availability.server";
import { type SkillInput, applicationSkillReplacementStatements } from "./skills.server";
import type { PartyStatus } from "./types";

export type SelfRegistrationInput = {
  eventId: string;
  userId: string;
  email: string;
  existingApplicationId?: string;
  name: string;
  contact: string;
  party: PartyStatus;
  note: string | null;
  skills: readonly SkillInput[];
  availability: readonly AvailabilityInput[];
};

export type SelfRegistrationResult =
  | { ok: true; applicationId: string }
  | { ok: false; reason: "duplicate_email" | "duplicate_user" };

/**
 * Saves the whole public self-registration form as one D1 transaction. The
 * final guard sees the current set of live slots inside the same batch, so a
 * sheet/slot added after form validation rolls back the profile and skills
 * along with availability.
 */
export async function saveSelfRegistration(
  db: D1Database,
  input: SelfRegistrationInput,
): Promise<SelfRegistrationResult> {
  const applicationId = input.existingApplicationId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const profileWrite = input.existingApplicationId
    ? db
        .prepare(`UPDATE applications
          SET name = ?, contact = ?, party = ?, note = ?, withdrawn = 0, updated_by = 'self', updated_at = ?
          WHERE id = ? AND event_id = ? AND user_id = ?`)
        .bind(
          input.name,
          input.contact,
          input.party,
          input.note,
          now,
          applicationId,
          input.eventId,
          input.userId,
        )
    : db
        .prepare(`INSERT INTO applications
          (id, event_id, user_id, email, name, contact, party, note, updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'self', ?, ?)`)
        .bind(
          applicationId,
          input.eventId,
          input.userId,
          input.email.trim().toLowerCase(),
          input.name,
          input.contact,
          input.party,
          input.note,
          now,
          now,
        );

  try {
    await db.batch([
      profileWrite,
      ...applicationSkillReplacementStatements(db, applicationId, input.skills),
      ...buildEventAvailabilityStatements(
        db,
        input.eventId,
        applicationId,
        input.availability,
        input.userId,
      ),
    ]);
  } catch (error) {
    const reason = applicationUniqueViolationReason(error);
    if (reason) return { ok: false, reason };
    throw error;
  }

  return { ok: true, applicationId };
}
