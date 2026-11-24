# Listings, metrics, budget, learning, shell, administration

## Sub-features

- `pr-listings`: Luma / TECH PLAY / Findy / Bevy listings are mapped from the brief;
  **掲載先を保存**; approval of Luma goes through the connpass fake (`createListing`).
- `pr-metrics-budget`: `/c/<slug>/metrics` shows the fake's numbers (**申込の状況**);
  `/c/<slug>/budget` **フライトを足す**; `/c/<slug>/metrics/import` CSV import reports
  **予算超過** once; **分析する** queues an analysis job.
- `pr-learning-export`: edits recorded per JSON leaf feed the retro; accepted proposals on
  `/playbook/proposals` export as JSON (`/playbook/proposals/export`).
- `pr-chapter-switch`: **チャプターを切り替える** changes the chapter cookie and every list.
- `pr-admin-runner`: `/admin/runner` for a super admin; a chapter member does not get it.

## How to get to it (user POV)

Event **詳細** menu; sidebar **設定**; the chapter switcher at the top left.

## Driving it with Orca Browser

Follow `apps/pr/e2e/listings.spec.ts`, `metrics.spec.ts`, and `learning.spec.ts` for inputs
and labels, using the identities from the README. Read fakes and D1 as in delivery.md.

## Gotchas

Not executed in the recorded run. `/contacts` import needs a Wiki access token and is outside
the map.
