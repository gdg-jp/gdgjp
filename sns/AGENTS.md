# Repository Guidelines

## Project Structure & Module Organization

`@gdgjp/sns` is a React Router v7 social-post scheduler deployed as a Cloudflare Worker. UI routes live in `app/routes/` and follow dotted names such as `settings.google-photos.ts`. Shared server logic belongs in `app/lib/`; reusable UI in `app/components/`; and global styles in `app/app.css`.

Worker integration is in `workers/` (`app.ts` is the entrypoint). Database migrations are ordered SQL files in `migrations/`; edit these rather than `schema.sql`, which is generated. Put static assets in `public/`.

The Google Photos importer runs on GitHub Actions (`.github/workflows/google-photos-import.yml`) and is implemented in `google-photos-importer/`. It polls configured shared albums and calls the Worker’s protected importer endpoint, which persists album/media metadata to D1 and stores imported media in the `MEDIA` R2 bucket. Keep its request contracts aligned with `workers/google-photos-importer.ts` and the API routes.

## Build, Test, and Development Commands

- `pnpm dev` — run the React Router development server.
- `pnpm build` — create the Worker/client production build.
- `pnpm typecheck` — regenerate Cloudflare and route types, then run TypeScript checks.
- `pnpm test` / `pnpm test:watch` — run Vitest once / in watch mode.
- `pnpm test:e2e` — run Playwright end-to-end tests.
- `pnpm migrate:local` — apply local D1 migrations and regenerate `schema.sql`.
- `pnpm deploy` — deploy with Wrangler.

## Coding Style & Naming Conventions

Use TypeScript, ESM, React function components, 2-space indentation, double quotes, semicolons, and trailing commas. Keep route files in React Router’s dotted naming convention; use `.server.ts` for server-only modules and colocate tests as `*.test.ts` or `*.test.tsx`. Use `import type` for type-only imports.

## Testing Guidelines

Write focused Vitest tests beside the code they cover, following examples in `app/lib/*.test.ts` and `workers/google-photos-importer.test.ts`. Test access control, publishing integrations, and migration-sensitive behavior. Run `pnpm test` and `pnpm typecheck` before submitting; run `pnpm test:e2e` for user-facing route changes.

## Commit & Pull Request Guidelines

Follow Conventional Commit subjects, normally scoped to this app: `feat(sns): add scheduled-post filter` or `fix(sns): handle expired X tokens`. Keep commits narrowly focused. PRs should explain the user impact, link the relevant issue, list validation performed, and include screenshots for UI changes. Call out D1 migrations, Cloudflare binding changes, or deployment/configuration requirements.

## Security & Configuration

Never commit `.dev.vars`, tokens, OAuth client secrets, or encryption keys. Copy required local settings from `.dev.vars.example`; configure production secrets with `wrangler secret put`. Treat OAuth credentials, Google Photos import tokens, and media access as sensitive.
