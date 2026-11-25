# sns (`sns.gdgs.jp`)

`@gdgjp/sns` is a React Router v7 social-post scheduler deployed as a Cloudflare Worker.
Read `ARCHITECTURE.md` before changing module ownership or dependencies; repository-wide
commands, style, commit, and secret rules are in the root `AGENTS.md`.

The Google Photos importer runs on GitHub Actions (`.github/workflows/google-photos-import.yml`)
and is implemented in `google-photos-importer/`. It polls configured shared albums and calls the
Worker's protected importer endpoint, which persists album/media metadata to D1 and stores
imported media in the `MEDIA` R2 bucket. Keep its request contracts aligned with
`app/features/google-photos/importer.server.ts` and the API routes.

Test access control, publishing integrations, and migration-sensitive behavior. Treat OAuth
credentials, Google Photos import tokens, and media access as sensitive.
