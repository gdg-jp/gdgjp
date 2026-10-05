-- Workflow instances cannot be resumed after replacing the Durable Object class.
-- Preserve all completed, archived, review, and commit data; only fail unfinished work explicitly.
UPDATE ingestion_sessions
SET status = 'error',
    error_message = 'This unfinished generation was interrupted by the Agents SDK upgrade. Please start it again.',
    phase_message = NULL,
    workflow_id = NULL,
    updated_at = unixepoch()
WHERE status IN ('pending', 'processing', 'awaiting_url_selection', 'awaiting_clarification');
