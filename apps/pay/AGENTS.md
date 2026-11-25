# GDG Japan Pay (`pay.gdgs.jp`)

Event expense reimbursement for GDG Japan. React Router v7 SSR on Cloudflare Workers
with D1, R2 receipts, Gemini extraction, and Google Sheets/Drive sync.

Feature ownership and dependency rules are documented in `ARCHITECTURE.md`.
Claim detail workflows live in `features/claims/detail.server.ts`.

## Secrets

| Secret | Purpose |
|---|---|
| `RP_SESSION_SECRET` | Signed session cookies |
| `IDP_CLIENT_SECRET` | Accounts OIDC client secret |
| `TOKEN_ENCRYPTION_KEY` | AES-GCM for bank account numbers |
| `GEMINI_API_KEY` | Receipt date/amount extraction; unset or blank stores uploads for manual entry without calling Gemini |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Drive + Sheets (template copy, fill, share without notification) |
| `RESEND_API_KEY` | Explicit confirmation email to comm-support |

Create D1/R2 before production deploy:

```sh
wrangler d1 create gdgjp-pay-db
wrangler r2 bucket create gdgjp-pay-receipts
```
