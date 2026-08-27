---
name: gdg-accounts
description: Use the gdg CLI to create, update, or delete GDG Accounts OIDC clients. Apply when a task concerns `gdg accounts oidc-client`; do not use for ordinary sign-in or other GDG services.
---

# GDG Accounts CLI

Use `gdg accounts oidc-client` for OIDC client lifecycle operations.

## Workflow

1. Confirm the current interface with `gdg accounts oidc-client --help` and the selected
   subcommand's `--help`. The checked-in CLI source is authoritative when developing this repo.
2. Ensure the operator is authenticated. If credentials are absent, ask them to run `gdg login`
   (or `gdg login --device` on a headless host).
3. Build the narrowest command that expresses the request. Do not invent redirect URIs, scopes,
   client IDs, or application URLs.
4. Treat create output as sensitive: it contains `client_secret`. Do not echo, log, or commit the
   secret; direct the operator to store it in the intended secret manager.
5. For update and delete, use the exact client ID supplied by the user or returned by a prior
   create. The CLI has no list/get command.

## Commands

All commands require a saved `gdg login` session and print JSON on success.

```sh
gdg accounts oidc-client create \
  --name NAME \
  --redirect-uri URI [--redirect-uri URI] \
  [--app-url URL] \
  [--post-logout-redirect-uri URI] \
  [--scope SCOPE]

gdg accounts oidc-client update CLIENT_ID \
  [--name NAME] [--app-url URL | --clear-app-url] \
  [--redirect-uri URI] \
  [--post-logout-redirect-uri URI | --clear-post-logout-redirect-uris] \
  [--scope SCOPE]

gdg accounts oidc-client delete CLIENT_ID --yes
```

Create requires `--name` and at least one `--redirect-uri`. Update rejects an empty patch. Passing
`--redirect-uri` or `--scope` on update replaces that entire list; include every value that must
remain. `--clear-app-url` and `--clear-post-logout-redirect-uris` are mutually exclusive with their
corresponding value flags.

## Important behavior

- `--redirect-uri`, `--post-logout-redirect-uri`, and `--scope` are string-slice flags. Cobra
  accepts repeated flags and comma-separated values; prefer repeated flags for clarity.
- Create defaults `--scope` to `https://gdgs.jp/scopes/chapters`.
- Update changes only explicitly supplied fields. Use the clear flags to remove optional values.
- Delete is irreversible and refuses to run without `--yes`; only run it when deletion is the
  user's explicit intent.
