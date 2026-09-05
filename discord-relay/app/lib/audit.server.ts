/**
 * Audit log recording for configuration changes and privileged actions (INFO-012).
 */

export type RecordAuditInput = {
  actorUserId: string;
  actorRole: "organizer" | "member" | "is_admin";
  chapterId: number | null;
  action: string;
  targetType: string;
  targetId: string;
  id?: string;
  occurredAt?: number;
};

/**
 * Record an audit log entry.
 * NOTE: COND-603 requires this call to fail the entire operation if the audit log
 * cannot be written. Never catch and ignore errors in this function.
 */
export async function recordAudit(db: D1Database, input: RecordAuditInput): Promise<void> {
  const id = input.id ?? crypto.randomUUID();
  const occurredAt = input.occurredAt ?? Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO audit_log (id, actor_user_id, actor_role, chapter_id, action, target_type, target_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.actorUserId,
      input.actorRole,
      input.chapterId,
      input.action,
      input.targetType,
      input.targetId,
      occurredAt,
    )
    .run();
}
