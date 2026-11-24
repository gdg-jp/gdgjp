# Self claims and proxy claims

A member with a saved profile creates one self claim per event. The event owner or an
organizer of the event's chapters registers a proxy claim for someone who does not use
the app.

## Sub-features

- `pay-claim-self` gates **経費を申請** on a saved profile, creates the single self claim, and redirects later attempts to it.
- `pay-claim-proxy` lets the owner or a chapter organizer create a proxy claim, rejects whitespace-only fields, and refuses plain members.

## How to get to it (user POV)

On an event page, choose **経費を申請** (disabled until a profile exists). It opens
`/events/<id>/claims/new` with the heading **経費を申請** and the button **申請を作成する**.
After creation the same position shows **自分の申請**. Owners and chapter organizers see
**代行登録**, which opens `/events/<id>/claims/proxy` with the heading **代行登録**, fields
**申請者氏名**, **銀行名**, **支店名**, **口座種別**, **口座番号**, and **申請を作成する**.

## Driving it with Orca Browser

Preconditions: the helper is ready with the seed applied. `pay-claim-self` runs after
`pay-profile-save` in the same `claimant` profile
(`/dev/login?as=claimant&chapter=1:gdg-tokyo:member&return_to=/`).

- Profile gate (`pay-claim-self`). Before `pay-profile-save`, open
  `/events/evt_0000000000000000000000SEE1` as `claimant`. Require a disabled **経費を申請**
  button and the status `口座情報の登録が必要です`. Navigate directly to
  `/events/evt_0000000000000000000000SEE1/claims/new` and require a redirect to `/profile`.
  Evidence: snapshot, network status.
- Create (`pay-claim-self`). After `pay-profile-save`, open the event and choose
  **経費を申請**. Require heading **経費を申請** and the text
  `Verify Seed Event 向けの申請を作成し、領収書を追加します。`. Choose **申請を作成する**.
  Require navigation to `/events/evt_0000000000000000000000SEE1/claims/clm_<26 characters>`,
  heading equal to the profile's legal name, description starting `申請日 ` with today's
  Asia/Tokyo date followed by ` / 本人 / ¥0`, and `まだ明細がありません。`. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT id, kind, user_id, applicant_name, bank_name, total_amount, status FROM claims WHERE user_id = 'dev-user-claimant'"`
  returns one `self` row for `dev-user-claimant` with `total_amount = 0` and `draft`.
  Evidence: snapshot, the D1 row.
- Single self claim (`pay-claim-self`). Return to the event. Require **自分の申請** in place
  of **経費を申請**. Navigate to `/events/evt_0000000000000000000000SEE1/claims/new` again and
  require a redirect to the existing claim URL. The D1 count for that user stays `1`.
- Proxy refused (`pay-claim-proxy`). As `member`
  (`/dev/login?as=member&chapter=1:gdg-tokyo:member&return_to=/`), require no **代行登録**
  on the seeded event, then navigate to
  `/events/evt_0000000000000000000000SEE1/claims/proxy` and require HTTP 403. Repeat as
  `outsider` (`/dev/login?as=outsider&chapter=2:gdg-osaka:organizer&return_to=/`) and
  require 403. Independent check with a curl cookie jar for `member`:
  `curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" -X POST --data-urlencode 'applicantName=x' --data-urlencode 'bankName=x' --data-urlencode 'branchName=x' --data-urlencode 'accountNumber=1' http://localhost:6164/events/evt_0000000000000000000000SEE1/claims/proxy`
  prints `403`, and no new proxy row exists.
- Proxy validation (`pay-claim-proxy`). As `coorganizer`
  (`/dev/login?as=coorganizer&chapter=1:gdg-tokyo:organizer&return_to=/`), choose
  **代行登録** on the seeded event. Fill **申請者氏名** `検証 代行次郎（架空）`, **銀行名** a single
  space, **支店名** `検証支店`, **口座番号** `0000004`, and choose **申請を作成する**. Require an
  alert titled `すべての項目を入力してください`.
- Proxy create (`pay-claim-proxy`). Fill **銀行名** `架空検証銀行` and submit. Require the
  claim page with heading `検証 代行次郎（架空）` and description containing ` / 代行 / ¥0`.
  Return to the event and require a new row `検証 代行次郎（架空） | 代行 | ¥0 | 下書き`.
  Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT kind, user_id, created_by, account_number_enc FROM claims WHERE applicant_name = '検証 代行次郎（架空）'"`
  returns `proxy`, `NULL`, `dev-user-coorganizer`, and a ciphertext that is not `0000004`.
  Evidence: snapshot of the event table, the D1 row.

## Gotchas

- The self-claim button stays disabled until a profile exists. A run that saves the
  `claimant` profile first cannot observe the gate afterwards; order the gate step first.
- One self claim per user and event is enforced by a unique index. A second attempt
  redirects instead of showing an error.
- Members of any chapter can create a self claim on any event they can open, including
  `outsider` on chapter 1's event. Record this if observed; it is current behavior.
- Proxy claims store bank data typed by the organizer. Use only fake values.
- Adding items to a new claim requires receipt upload, which is outside this map. Item
  editing uses the seeded claims in [Claim detail](claim-detail.md).
