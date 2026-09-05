# @gdgjp/discord-relay

Control Plane for the GDG Japan Discord Gateway → HTTP outgoing webhook relay service,
deployed at `relay.gdgs.jp`.

This package provides the administration dashboard, OIDC authentication, chapter tenancy
boundary, audit logging, and (in later stages) server registration, routing rules, and delivery monitoring.

## Stage 01 Scope

- Relying-party OIDC authentication via GDG Accounts (`https://accounts.gdgs.jp`)
- Chapter-based multi-tenancy (`chapters` claim array, chapter switching cookie)
- Audit log recording for configuration and privileged actions (INFO-012)
- Immediate reflection of membership revocation without claims caching (COND-604)

## Routes

- `/` — dashboard skeleton (auth + chapter required)
- `/signin`, `/api/auth/*`, `/auth/signout` — relying-party OIDC authentication
- `/no-chapter` — shown when the user has no GDG chapter memberships
- `/api/chapter` — chapter switcher endpoint (sets `discord-relay-chapter` cookie)
- `/dev/login` — non-production local/e2e login shortcut (404 in production)

## Data

- **D1 (`DB`)** — relying-party auth tables (`user`, `oidc_session`), chapter directory cache (`chapters`), and audit log (`audit_log`).
- Migrations in `migrations/`; `schema.sql` is generated (`pnpm migrate:local`).

## Local development

```sh
pnpm --filter @gdgjp/discord-relay migrate:local   # apply D1 migrations to local DB
pnpm --filter @gdgjp/discord-relay dev             # http://localhost:5181
```

Create `discord-relay/.dev.vars` from `.dev.vars.example`.
For testing with simulated login, use `/dev/login?as=dev&chapter=1:tokyo&role=organizer&return_to=/`.
