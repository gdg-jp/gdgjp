# google-documents

Google Docs → wiki page import: preview, a long-running queued job, then apply.

- `import.server.ts` — preview / job / apply stages.

Routes: `app/routes/api/google/documents-*.ts`. Queue: `GOOGLE_DOCUMENT_IMPORT_QUEUE` (via
`app/lib/queue-processors.server.ts`). Docs→Markdown: `app/features/google/docs-markdown.server.ts`.
