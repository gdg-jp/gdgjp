import { signPayload, verifyPayload } from "@gdgjp/gdg-lib";
import type { EventRecord } from "~/features/events/events.server";
import type { Actor } from "~/features/history/types";
import { assignmentKey } from "~/features/solver/types";
import {
  type CrossSheetConflict,
  canonicalizeConflicts,
  crossSheetConflictGuard,
  findCrossSheetConflicts,
  fingerprint,
} from "./cross-sheet-conflicts.server";
import { readAssignmentsState, writeManualEdit } from "./roster.server";

export type ManualAssignmentInput = {
  applicationId: string;
  trackId: string;
  roleId: string;
  slotIds: string[];
};

export type ManualAssignmentResult =
  | { ok: true; intent: "assign" }
  | { error: string; intent: "assign" }
  | {
      warning: "cross-sheet";
      conflicts: CrossSheetConflict[];
      assignment: ManualAssignmentInput;
      confirmation: string;
      intent: "assign";
    };

const MAX_MANUAL_ASSIGNMENT_SLOTS = 32;
const MAX_CONFLICTS = 256;
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5_000;

export async function assignManually(
  db: D1Database,
  event: EventRecord,
  actor: Actor,
  assignment: ManualAssignmentInput,
  confirmation: string,
  secret: string,
  rosterSheetId?: string,
): Promise<ManualAssignmentResult> {
  const sheetId = rosterSheetId ?? `default:${event.id}`;
  const slotIds = [...new Set(assignment.slotIds)];
  if (
    !assignment.applicationId ||
    !assignment.trackId ||
    !assignment.roleId ||
    slotIds.length === 0 ||
    slotIds.length > MAX_MANUAL_ASSIGNMENT_SLOTS
  ) {
    return { error: "入力が不正です。", intent: "assign" };
  }

  const state = await readAssignmentsState(db, event.id, sheetId);
  const revisionHeadSignature = await readRevisionHeadSignature(
    db,
    event.id,
    sheetId,
    state.revisionCursor,
  );
  const next = state.assignments;
  for (const slotId of slotIds) {
    next.set(assignmentKey(assignment.applicationId, slotId), {
      trackId: assignment.trackId,
      roleId: assignment.roleId,
      locked: false,
    });
  }

  const signedConfirmation = confirmation
    ? await verifyPayload<ManualAssignmentConfirmation>(confirmation, secret)
    : null;
  const proposal = { ...assignment, slotIds };
  const stateFingerprint = await fingerprint(
    [...state.assignments].sort(([a], [b]) => a.localeCompare(b)),
  );
  const currentConflicts = canonicalizeConflicts(
    await findCrossSheetConflicts(db, event.id, sheetId, assignment.applicationId, slotIds),
  );
  if (currentConflicts.length > MAX_CONFLICTS) {
    return {
      error: "重複が多すぎるため割り当てできません。シフト表を確認してください。",
      intent: "assign",
    };
  }

  const tokenMatches = await isMatchingConfirmation(
    signedConfirmation,
    event.id,
    sheetId,
    actor.id,
    proposal,
    state.revisionCursor,
    stateFingerprint,
    revisionHeadSignature,
    currentConflicts,
  );
  if (confirmation && !tokenMatches) {
    return issueWarning(
      event.id,
      sheetId,
      actor.id,
      proposal,
      currentConflicts,
      state.revisionCursor,
      stateFingerprint,
      revisionHeadSignature,
      secret,
    );
  }
  if (!confirmation && currentConflicts.length > 0) {
    return issueWarning(
      event.id,
      sheetId,
      actor.id,
      proposal,
      currentConflicts,
      state.revisionCursor,
      stateFingerprint,
      revisionHeadSignature,
      secret,
    );
  }
  const allowedConflicts = tokenMatches && signedConfirmation ? signedConfirmation.conflicts : [];

  try {
    await writeManualEdit(
      db,
      event,
      actor,
      next,
      sheetId,
      state.revisionCursor,
      slotIds.map((slotId) =>
        crossSheetConflictGuard(
          db,
          event.id,
          sheetId,
          assignment.applicationId,
          slotId,
          allowedConflicts,
        ),
      ),
    );
  } catch (error) {
    if (isConflictGuardFailure(error)) {
      const latest = await readAssignmentsState(db, event.id, sheetId);
      const latestHeadSignature = await readRevisionHeadSignature(
        db,
        event.id,
        sheetId,
        latest.revisionCursor,
      );
      const latestFingerprint = await fingerprint(
        [...latest.assignments].sort(([a], [b]) => a.localeCompare(b)),
      );
      const latestConflicts = canonicalizeConflicts(
        await findCrossSheetConflicts(db, event.id, sheetId, assignment.applicationId, slotIds),
      );
      if (latestConflicts.length > MAX_CONFLICTS) {
        return {
          error: "重複が多すぎるため割り当てできません。シフト表を確認してください。",
          intent: "assign",
        };
      }
      return issueWarning(
        event.id,
        sheetId,
        actor.id,
        proposal,
        latestConflicts,
        latest.revisionCursor,
        latestFingerprint,
        latestHeadSignature,
        secret,
      );
    }
    throw error;
  }
  return { ok: true, intent: "assign" };
}

type ManualAssignmentConfirmation = ManualAssignmentInput & {
  eventId: string;
  rosterSheetId: string;
  actorId: string;
  issuedAt: number;
  revisionCursor: number | null;
  revisionHeadSignature: string | null;
  stateFingerprint: string;
  conflicts: CrossSheetConflict[];
  conflictFingerprint: string;
};

async function isMatchingConfirmation(
  confirmation: ManualAssignmentConfirmation | null,
  eventId: string,
  rosterSheetId: string,
  actorId: string,
  assignment: ManualAssignmentInput,
  revisionCursor: number | null,
  stateFingerprint: string,
  revisionHeadSignature: string | null,
  currentConflicts: readonly CrossSheetConflict[],
): Promise<boolean> {
  if (!confirmation || !Array.isArray(confirmation.conflicts)) return false;
  const now = Date.now();
  if (
    !Number.isSafeInteger(confirmation.issuedAt) ||
    confirmation.issuedAt > now + FUTURE_CLOCK_SKEW_MS ||
    now - confirmation.issuedAt > CONFIRMATION_TTL_MS ||
    confirmation.revisionCursor !== revisionCursor ||
    confirmation.revisionHeadSignature !== revisionHeadSignature ||
    confirmation.stateFingerprint !== stateFingerprint
  ) {
    return false;
  }
  const signedConflicts = canonicalizeConflicts(confirmation.conflicts);
  const signedFingerprint = await fingerprint(signedConflicts);
  const currentFingerprint = await fingerprint(currentConflicts);
  return Boolean(
    confirmation.eventId === eventId &&
      confirmation.rosterSheetId === rosterSheetId &&
      confirmation.actorId === actorId &&
      confirmation.applicationId === assignment.applicationId &&
      confirmation.trackId === assignment.trackId &&
      confirmation.roleId === assignment.roleId &&
      JSON.stringify(confirmation.slotIds) === JSON.stringify(assignment.slotIds) &&
      confirmation.conflictFingerprint === signedFingerprint &&
      confirmation.conflictFingerprint === currentFingerprint &&
      JSON.stringify(signedConflicts) === JSON.stringify(currentConflicts),
  );
}

async function issueWarning(
  eventId: string,
  rosterSheetId: string,
  actorId: string,
  assignment: ManualAssignmentInput,
  conflicts: CrossSheetConflict[],
  revisionCursor: number | null,
  stateFingerprint: string,
  revisionHeadSignature: string | null,
  secret: string,
): Promise<ManualAssignmentResult> {
  const canonicalConflicts = canonicalizeConflicts(conflicts);
  const conflictFingerprint = await fingerprint(canonicalConflicts);
  return {
    warning: "cross-sheet",
    conflicts: canonicalConflicts,
    assignment,
    confirmation: await signPayload(
      {
        eventId,
        rosterSheetId,
        actorId,
        ...assignment,
        issuedAt: Date.now(),
        revisionCursor,
        revisionHeadSignature,
        stateFingerprint,
        conflicts: canonicalConflicts,
        conflictFingerprint,
      },
      secret,
    ),
    intent: "assign",
  };
}

async function readRevisionHeadSignature(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  revisionCursor: number | null,
): Promise<string | null> {
  if (revisionCursor === null) return null;
  const head = await db
    .prepare(
      `SELECT id, created_at, snapshot, metrics FROM revisions
       WHERE event_id = ? AND roster_sheet_id = ? AND seq = ?`,
    )
    .bind(eventId, rosterSheetId, revisionCursor)
    .first<{ id: string; created_at: string; snapshot: string; metrics: string }>();
  return head ? fingerprint(head) : null;
}

function isConflictGuardFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "UNIQUE constraint failed: assignments.application_id, assignments.time_slot_id",
    )
  );
}
