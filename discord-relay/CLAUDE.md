# Discord Relay (`relay.gdgs.jp`)

Discord Gateway → HTTP outgoing webhook relay service Control Plane.

## Architecture

- React Router v7 SSR on Cloudflare Workers
- D1 (`DB`) for auth (`user`, `oidc_session`), metadata cache (`chapters`), and audit logging (`audit_log`)
- Relying-party OIDC authentication via GDG Accounts (`ACCOUNTS` service binding)

## Critical Invariants

1. **No Claims Caching (COND-604 / REQ-601)**: Always call `getFreshClaims()`. Never cache claims in memory or module scope. Loss of chapter membership must take effect immediately.
2. **Use `chapters` Array (REQ-603)**: Never rely on the singular `chapter` legacy claim. Support multi-chapter users via `discord-relay-chapter` cookie.
3. **Audit Admin Cross-Chapter Access (COND-603)**: When an admin (`is_admin`) accesses a chapter outside their own memberships, record `chapter.cross_access` in `audit_log`. Never allow unrecorded cross-access; if logging fails, fail the request.
4. **No Direct Plane-to-Plane Inbound**: Data Plane connects outbound to Control Plane. Control Plane never initiates connections to Data Plane.

## Routes (`app/routes.ts`)

- `/` — dashboard skeleton
- `/signin`, `/api/auth/*`, `/auth/signout` — OIDC RP auth (`cookiePrefix: "gdgjp-discord-relay"`)
- `/no-chapter` — zero memberships landing page
- `/api/chapter` — chapter switch POST handler
- `/dev/login` — dev/test login (404 in production)
