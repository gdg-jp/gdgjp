-- Agent/Workflow ingestion migration.
--
-- D1 remains the UI-facing source of truth. The workflow ID supports
-- idempotent Queue delivery, while the JSON columns retain access and context
-- provenance without storing source bodies in Durable Object state.
ALTER TABLE "ingestion_sessions" ADD COLUMN "workflow_id" TEXT;
ALTER TABLE "ingestion_sessions" ADD COLUMN "access_context_json" TEXT;
ALTER TABLE "ingestion_sessions" ADD COLUMN "context_manifest_json" TEXT;

-- The legacy in-process pipeline cannot safely resume after this deployment:
-- its transient context and credentials are not compatible with the durable
-- agent workflow. Preserve completed and archived sessions unchanged.
UPDATE "ingestion_sessions"
SET
  "status" = 'error',
  "error_message" = 'AI ingestion was upgraded. Please start the ingestion again.',
  "phase_message" = 'Restart required after AI ingestion upgrade.',
  "updated_at" = unixepoch()
WHERE "status" IN (
  'pending',
  'processing',
  'awaiting_clarification',
  'awaiting_url_selection'
);
