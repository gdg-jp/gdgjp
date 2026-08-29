# zip-import

Import a `.zip` of Markdown files into wiki pages (preview, then commit).

Entry point:

- `import.server.ts` — parse archive (`fflate`), map files to slugs, create pages.

Routes: `app/routes/api/pages/import-zip-preview.ts`, `app/routes/api/pages/import-zip.ts`.
