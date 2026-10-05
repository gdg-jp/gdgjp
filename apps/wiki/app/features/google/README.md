# google

Google integrations: Drive, Docs, Forms, Chat, Picker, plus the Docs-import feature in `documents/`.

- `drive.server.ts` / `drive-token.server.ts` / `drive-utils.ts` — Drive REST + OAuth token rows + kind detection.
- `docs-markdown.server.ts` — Google Docs JSON → Markdown.
- `forms.server.ts` / `forms-utils.ts` / `survey-stats.server.ts` — Forms fetch + survey aggregation.
- `chat.server.ts` — Google Chat spaces/messages.
- `picker.client.ts` — browser-only Google Picker loader. `components/GoogleDocumentImportDialog.tsx`.
- `documents/import.server.ts` — Docs-import preview / job / apply (own README).

Caveat: keep the `.server` / `.client` suffix — Drive tokens and OAuth secrets must not reach the client bundle.
