# GDG Japan Pay (`pay.gdgs.jp`)

Event expense reimbursement for GDG Japan. React Router v7 SSR on Cloudflare Workers
with D1, R2 receipts, Gemini extraction, and Google Sheets/Drive sync.

Feature ownership and dependency rules are documented in `ARCHITECTURE.md`.
Keep domain SQL in `app/features/<domain>/repository.server.ts`, browser-safe
data types in `types.ts`, and domain tests beside their feature. Domain widgets
belong in `features/<domain>/components/`, composed screens in their registered `routes/<domain>/` modules,
and shared composed layouts in `app/layouts/`; `app/components/` is domain-free UI.
Routes compose features; claim detail workflows live in `features/claims/detail.server.ts`.

## Local development

```sh
cp .dev.vars.example .dev.vars
# Fill RP_SESSION_SECRET, IDP_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY, GEMINI_API_KEY,
# GOOGLE_SERVICE_ACCOUNT_JSON, RESEND_API_KEY

pnpm --filter @gdgjp/pay migrate:local
pnpm --filter @gdgjp/pay dev
```

Dev server: http://localhost:5182

Seed the `pay` OAuth client in accounts via `/admin/seed-clients` after setting
`PAY_CLIENT_SECRET` and `PAY_REDIRECT_URLS`.

## Secrets

| Secret | Purpose |
|---|---|
| `RP_SESSION_SECRET` | Signed session cookies |
| `IDP_CLIENT_SECRET` | Accounts OIDC client secret |
| `TOKEN_ENCRYPTION_KEY` | AES-GCM for bank account numbers |
| `GEMINI_API_KEY` | Receipt date/amount extraction |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Drive + Sheets (template copy, fill, share without notification) |
| `RESEND_API_KEY` | Explicit confirmation email to comm-support |

Create D1/R2 before production deploy:

```sh
wrangler d1 create gdgjp-pay-db
wrangler r2 bucket create gdgjp-pay-receipts
```
