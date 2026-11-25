# Claim detail, items, and the local outcomes of sync and email

A claim page lists its items. The claimant (self claims) or the event's managers (proxy
claims) edit and delete items; other managers see a read-only table; everyone else is
refused. The page offers **スプレッドシートに反映** and **comm-support に確認メールを送る**,
whose successful outcomes reach Google and Resend and are outside this map; their local
refusal states are covered here.

## Sub-features

- `pay-claim-access` shows edit, read-only, and forbidden views of the seeded claims, plus 404 for a claim under the wrong event.
- `pay-claim-items` updates an item, rejects an invalid amount, deletes an item, and recalculates the total.
- `pay-claim-sync-unconnected` shows the empty-claim and no-Google-connection errors of **スプレッドシートに反映**.
- `pay-claim-email-unconfigured` shows the disabled email button before sync and the configuration error after a seeded sync.

## How to get to it (user POV)

From an event page choose **開く** on a claim row, or **自分の申請**. The page heading is
the applicant name, the description is `申請日 <date> / 本人|代行 / ¥<total>`, and the back
link is the event title. Editors see a card **領収書 PDF / 写真を追加** with
**アップロードして抽出**, the region **明細** with per-item fields **月日**, **種別**, **品目**,
**金額（円）**, buttons **保存** and **この明細を削除**, and the region **スプレッドシート連携**.

## Driving it with Orca Browser

Preconditions: the helper is ready with the seed applied and the scratch `.dev.vars`
sets `TOKEN_ENCRYPTION_KEY=verify-pay-token-encryption-key` and does not set
`RESEND_API_KEY` or `GEMINI_API_KEY`. Seeded URLs:
proxy claim C1 `/events/evt_0000000000000000000000SEE1/claims/clm_0000000000000000000000SEC1`
(created by `organizer`, items 3,000 + 1,500 yen) and self claim C2
`/events/evt_0000000000000000000000SEE1/claims/clm_0000000000000000000000SEC2`
(claimant `member`, one 2,000 yen item, already marked synced with a fake sheet URL).

- Editor view (`pay-claim-access`). As `coorganizer`
  (`/dev/login?as=coorganizer&chapter=1:gdg-tokyo:organizer&return_to=/`), open C1.
  Require heading `検証 代行花子（架空）`, description `申請日 2026-01-05 / 代行 / ¥4,500`,
  **アップロードして抽出**, two item groups with **金額（円）** values `3000` and `1500`, two
  **この明細を削除** buttons, **スプレッドシートに反映**, and a disabled
  **comm-support に確認メールを送る**.
- Read-only manager view (`pay-claim-access`). As `organizer`
  (`/dev/login?as=organizer&chapter=1:gdg-tokyo:organizer&return_to=/`), open C2. Require
  heading `検証 メンバー太郎（架空）`, a table with headers **月日**, **種別**, **品目**, **金額**
  and the row `2026-01-06 | ケータリング | 検証用軽食（架空） | ¥2,000`, and no
  **アップロードして抽出**, **保存**, **この明細を削除**, or **スプレッドシート連携** region.
- Forbidden and not found (`pay-claim-access`). As `member`
  (`/dev/login?as=member&chapter=1:gdg-tokyo:member&return_to=/`), open C1 and require
  HTTP 403. As `outsider` (`/dev/login?as=outsider&chapter=2:gdg-osaka:organizer&return_to=/`),
  open C2 and require 403. As `member`, open
  `/events/evt_0000000000000000000000SEE2/claims/clm_0000000000000000000000SEC2` and require
  404. Evidence: one snapshot per view and each navigation's HTTP status.
- Invalid amount (`pay-claim-items`). As `coorganizer` on C1, set the first item's
  **金額（円）** to `abc` and choose that item's **保存**. Require an alert titled
  `明細の入力内容を確認してください` and description still `¥4,500`.
- Update (`pay-claim-items`). Set the first item's **金額（円）** to `¥3,300` and choose
  **保存**. Require a success notice `明細を更新しました`, description `… / 代行 / ¥4,800`, and
  the field value `3300` after reload. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT c.total_amount, i.amount_yen FROM claims c JOIN claim_items i ON i.claim_id = c.id WHERE i.id = 'itm_FIXTURE_C1_A'"`
  returns `4800 | 3300`.
- Delete (`pay-claim-items`). Choose the second item's **この明細を削除**. Require
  `明細を削除しました`, one remaining item group, and description `¥3,300`. Independent
  check: `SELECT COUNT(*) FROM claim_items WHERE claim_id = 'clm_0000000000000000000000SEC1'`
  returns `1` and `SELECT total_amount FROM claims WHERE id = 'clm_0000000000000000000000SEC1'`
  returns `3300`. Open the event as `coorganizer` and require the C1 row at `¥3,300` and
  the event description `合計 ¥5,300`. Evidence: snapshot after each action, the D1 rows.
- Sync with no items (`pay-claim-sync-unconnected`). As `claimant`, on the self claim
  created in `pay-claim-self`, choose **スプレッドシートに反映**. Require an alert titled
  `明細がありません` and the claim status in D1 still `draft`.
- Sync without a Google connection (`pay-claim-sync-unconnected`). As `coorganizer` on C1
  (which has items; its event has no Google connection), choose **スプレッドシートに反映**.
  Require an alert titled
  `このイベントはGoogleアカウントが連携されていません。イベントページの「Google連携」から設定してください。`.
  Independent check: `SELECT status, sheet_url FROM claims WHERE id = 'clm_0000000000000000000000SEC1'`
  returns `draft | NULL`. Evidence: snapshot, network list showing no request to a
  `googleapis.com` host.
- Email unconfigured (`pay-claim-email-unconfigured`). On C1 as `coorganizer`, require
  **comm-support に確認メールを送る** disabled and no **Sheets を開く** link. As `member` on C2,
  require the button enabled, a **Sheets を開く** link to
  `https://example.invalid/verify-pay/fixture-sheet` (do not open it), and choose
  **comm-support に確認メールを送る**. Require an alert titled
  `RESEND_API_KEY is not configured`. Independent check:
  `SELECT email_sent_at FROM claims WHERE id = 'clm_0000000000000000000000SEC2'` returns
  `NULL`, and the event row for C2 does not show `メール送信済`. Evidence: snapshot,
  network list showing no request to `api.resend.com`.

## Gotchas

- Receipt upload (**アップロードして抽出**) always calls the Gemini API at
  `generativelanguage.googleapis.com`, even when `GEMINI_API_KEY` is empty. It is outside
  this map. Do not choose it; seeded items stand in for uploaded ones.
- A successful **スプレッドシートに反映** writes to Google Drive and Sheets, and a successful
  **comm-support に確認メールを送る** mails `comm-support@voice-research.com` through Resend.
  Both are outside the map. Never run the email step when `RESEND_API_KEY` is set in the
  scratch `.dev.vars`, and never run sync on `Verify Google Seed Event`, whose seeded
  Google connection makes the app call Google.
- Sync decrypts the claim's bank data before checking the Google connection. If the
  scratch `TOKEN_ENCRYPTION_KEY` differs from the seed's key, the C1 sync step fails with
  a server error. Report that as an unmet precondition, not a product failure.
- Self claims are editable only by their claimant, so the event owner sees C2 read-only.
  Proxy claims are editable by any manager of the event and by their creator.
- **この明細を削除** has no confirmation dialog. Run the update step before the delete step,
  and run both after the read-only access steps that quote the seeded totals.
- Multiple items repeat the same field labels. Scope each action to one item group by its
  position or by its **品目** value.
