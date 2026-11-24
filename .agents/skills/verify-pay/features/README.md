# Pay feature map

Drive these journeys in the isolated stack from [verify-pay](../SKILL.md), started with
`node scripts/verification/app-stack.mjs --app pay --serve`. Current-run status and
evidence belong in [coverage.json](../coverage.json). Every journey starts as
`NOT VERIFIED`; a source recipe is not execution evidence.

| Journey IDs | Feature | Identity |
| --- | --- | --- |
| `pay-anon-home`, `pay-signin-continuation` | [Sign-in and membership gate](auth.md) | Anonymous |
| `pay-no-membership` | [Sign-in and membership gate](auth.md) | `nochapter` |
| `pay-events-empty` | [Events](events.md) | `organizer` on an unseeded launch |
| `pay-events-list`, `pay-event-create`, `pay-event-roles` | [Events](events.md) | `organizer`, `coorganizer`, `member`, `outsider` |
| `pay-profile-save` | [Legal name and bank account](profile.md) | `claimant` |
| `pay-claim-self` | [Self and proxy claims](claims.md) | `claimant` |
| `pay-claim-proxy` | [Self and proxy claims](claims.md) | `coorganizer`, `member`, `outsider` |
| `pay-claim-access`, `pay-claim-items` | [Claim detail](claim-detail.md) | `coorganizer`, `organizer`, `member`, `outsider` |
| `pay-claim-sync-unconnected`, `pay-claim-email-unconfigured`, `pay-receipt-upload-manual` | [Claim detail](claim-detail.md) | `claimant`, `coorganizer`, `member` |
| `pay-receipt-access` | [Receipt viewing](receipts.md) | `member`, `organizer`, `claimant`, `outsider`, anonymous |
| `pay-google-card-states`, `pay-google-connect-redirect`, `pay-google-callback-errors`, `pay-google-settings-guards` | [Google connection](google.md) | `organizer`, `coorganizer`, `member` |
| `pay-signout` | [Sign-in and membership gate](auth.md) | `member` |

## Identities

Sign in by navigating the browser to the dev login on `http://localhost:6164`. The user
id becomes `dev-user-<label>`. Pay ignores `admin=1`; every permission comes from the
user id and the chapter list. Use a separate browser profile per identity.

| Label | Dev login path |
| --- | --- |
| `organizer` | `/dev/login?as=organizer&chapter=1:gdg-tokyo:organizer&return_to=/` |
| `coorganizer` | `/dev/login?as=coorganizer&chapter=1:gdg-tokyo:organizer&return_to=/` |
| `member` | `/dev/login?as=member&chapter=1:gdg-tokyo:member&return_to=/` |
| `claimant` | `/dev/login?as=claimant&chapter=1:gdg-tokyo:member&return_to=/` |
| `outsider` | `/dev/login?as=outsider&chapter=2:gdg-osaka:organizer&return_to=/` |
| `nochapter` | `/dev/login?as=nochapter&chapter=0:none:member&return_to=/` |

`pay-event-create` signs `organizer` in once with an extra chapter
(`&chapter=3:gdg-kyoto:member`) to prove the chapter snapshot.

For HTTP checks, create a curl cookie jar per identity:
`JAR=$(mktemp); curl -s -c "$JAR" -o /dev/null 'http://localhost:6164/dev/login?as=organizer&chapter=1:gdg-tokyo:organizer&return_to=/'`,
then pass `-b "$JAR"`. Run D1 checks from the scratch `apps/pay` directory with
`pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "<SQL>"`, adding
`--persist-to <dir>` when the helper reports a non-default persistence directory.

## Baseline preconditions

- The helper serves the current source snapshot at `http://localhost:6164` with
  `APP_URL=http://localhost:6164`, `ENVIRONMENT=development`, and fresh local D1 and R2.
- `fixtures/seed.sql` is applied before start. Its rows are fabricated: two dev users,
  `Verify Seed Event` with a proxy claim and a synced self claim, and
  `Verify Google Seed Event` with a fake Google connection.
- The scratch `.dev.vars` sets `TOKEN_ENCRYPTION_KEY=verify-pay-token-encryption-key`,
  which the seed's ciphertexts require, and leaves `GEMINI_API_KEY`,
  `RESEND_API_KEY`, and `GOOGLE_OAUTH_CLIENT_SECRET` unset. If any of the three is set,
  stop: the email journey would send real mail.
- `pay-receipt-access` additionally needs the local R2 object described in
  [receipts.md](receipts.md).
- `pay-signin-continuation` needs `--platform <verify-platform ready.json>`. Every other journey uses dev sessions
  and does not call Accounts.

## Ordering constraints

1. Run `pay-events-empty` on an unseeded launch, or record it as not reachable.
2. Run read-only views first: `pay-anon-home`, `pay-no-membership`, `pay-events-list`,
   `pay-event-roles`, `pay-claim-access`, `pay-google-card-states`, `pay-receipt-access`.
   They quote the seeded totals (`¥6,500`, `¥4,500`, `¥2,000`).
3. Run the claimant chain in order: the profile-gate step of `pay-claim-self`, then
   `pay-profile-save`, then the rest of `pay-claim-self`, then the empty-claim step of
   `pay-claim-sync-unconnected`, then `pay-receipt-upload-manual`.
4. Run `pay-event-create`, `pay-claim-proxy`, then `pay-claim-items` (update before delete), then the C1 step
   of `pay-claim-sync-unconnected`, then `pay-claim-email-unconfigured`.
5. Run the HTTP-only Google journeys in any order after step 2.
6. Run `pay-signout` last.

## Not covered

- Gemini receipt extraction. Upload with a nonblank `GEMINI_API_KEY` posts the file to
  the Gemini API, and there is no local fake; `pay-receipt-upload-manual` covers upload
  without a key.
- Successful **スプレッドシートに反映**, which copies the template and writes to Google Drive and
  Sheets, and every Google step after the redirect: consent, token exchange and refresh,
  the Drive Picker, template grant, and folder selection.
- Successful **comm-support に確認メールを送る**, which sends mail through Resend.
- The real Accounts OIDC callback, token refresh, and remote session revocation for Pay.
- Header links to other GDG apps and to Accounts settings, theme switching, layout at
  other widths (the Playwright UI suite covers these screens with fixture data), and the
  local states that depend on Google responses (expired connection, wrong file type).
