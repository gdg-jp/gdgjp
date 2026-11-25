# connpass pages and mail

The connpass page is rendered from the runner's slots and sent on approval through the
connpass app's jobs (the fake here). A connpass mail is approved per group target and sent by
the minute cron at its time, never on approval.

## Sub-features

- `pr-mail-waits-for-time`: an approved mail target shows **予定の時刻に送ります**; a minute
  cron before the time adds no `send_event_message` job; after the time two cron runs add
  exactly one.
- `pr-connpass-page`: a page draft shows a preview built from slots; approval adds one
  `update_event` job to the fake; a thumbnail over 1 MB is refused with
  **connpass の画像は 1 MB までです**.

## How to get to it (user POV)

`/c/<slug>/settings` for **有効化** and the connpass group handle; **予定表** to add a
`connpass_mail` item; **下書き** → the draft → **承認** → **group-1 で予約**.

## Driving it with Orca Browser

Preconditions: `lead`, event with brief, delivery activated, connpass group `group-1` added as
a delivery handle. Runner output for mail: `skills/pr-connpass-mail/references/example-output.json`.

- Request the mail draft from **予定表** as in delivery.md and post the runner result.
- Approve the draft, click **group-1 で予約**, require **予定の時刻に送ります**.
- Count `send_event_message` jobs in `/dev/mock-services` `connpass`, run
  `/dev/cron?name=minute`, require no change. Move the item before now through the item's
  **編集** form, run the minute cron twice, require exactly one more job whose subject equals
  the runner output's subject.

## Gotchas

Not executed in the recorded run; see coverage.json. The connpass app itself is never
contacted: `CONNPASS` is bound to `e2e/mock-services/connpass.ts`.
