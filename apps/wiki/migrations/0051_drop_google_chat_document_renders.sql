-- Sender display names are no longer baked into Chat Markdown; CLI resolves them.
-- Render payloads (full week message JSON) are no longer needed.
DROP TABLE IF EXISTS "google_chat_document_renders";
