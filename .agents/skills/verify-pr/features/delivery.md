# Delivery: review, approval, dispatch targets, follow-up

A runner draft is reviewed and approved at a specific version. Each X account is a dispatch
target, approved by a member of that account's chapter; only that approval calls sns, as the
approver, with the approved version. A version saved after an approval invalidates it.

## Sub-features

- `pr-delivery-setup`: chapter webhook saved masked (`現在: 127.0.0.1:6162/api/webhooks/…/••••`);
  each chapter adds its own X account on `/c/<slug>/settings` (**追加** →
  **@chapterN を配信先に追加しました**); **有効化** creates the tinyurl campaign in the fake.
- `pr-no-send-before-approval`: after a runner draft exists, and again after the draft is
  approved but before any target approval, `sns.calls` is 0. Before draft approval the card
  says **下書きを承認すると配信先が並びます**. An approval blocked by a Playbook rule
  (empty OGP image → **OGP-ON-SHORTLINK**) leaves the draft unapproved.
- `pr-stale-version-refused`: with the draft page open at version N in tab A, save version
  N+1 in tab B; pressing **承認** in tab A is refused with
  **新しい版が保存されています。読み直してから操作してください** and the draft stays unapproved;
  after approval of N+1, saving N+2 and pressing **@chapter1 で予約** on a page still showing
  N+1 is refused the same way; `sns.calls` does not change.
- `pr-target-own-chapter`: on the approved draft, `lead` sees **@chapter1 で予約** and, for
  @chapter2, **そのチャプターのメンバーが承認します**. Pressing **@chapter1 で予約** creates exactly
  one sns post for chapter 1 with actor `dev-user-lead`, text containing the short link and no
  `{{shortlink}}`; a second press does not create another. `osaka` presses **@chapter2 で予約**;
  the post's actor is `dev-user-osaka`.
- `pr-target-double-press`: two tabs of the approver both show **@chapter1 で予約**; pressing
  both at once creates exactly one sns post, and the second tab shows
  **この配信先はもう処理されています**.
- `pr-status-and-alerts`: after the fake publishes the post and the hourly cron runs, the
  target shows **投稿済み**; the dead link produces one **リンク切れ** Discord message.

## How to get to it (user POV)

Sidebar **設定** (`/settings`) for the webhook. Event **詳細** → **設定**
(`/c/<slug>/settings`) for delivery accounts and **有効化**. **予定表** to add the post and
request drafts (**「<title>」の下書きを作る**, **選んだ投稿の下書きを runner に頼む**).
**詳細** → **下書き** (`/c/<slug>/drafts`) → the draft → **承認** and the **配信** card.

## Driving it with Orca Browser

Preconditions: `lead` profile and `osaka` profile; event with brief and co-host chapter 2;
webhook `http://127.0.0.1:6162/hook/<unique>`. Record `/dev/mock-services` and
`/messages` before each step.

- Setup. As `lead`, `/c/<slug>/settings`, click the first **追加**; as `osaka`, the same.
  As `lead`, require **投稿できる人: lead (dev)**, click **有効化**, require
  **有効化しました（チャネル N 本）**. Read `tinyurl.campaigns` from the fake.
- Draft. On **予定表** add an X post 30 minutes ahead titled `開催決定`, check
  **「開催決定」の下書きを作る**, click **選んだ投稿の下書きを runner に頼む**. Act as the
  runner: `GET /api/runner/jobs/next?types=post&wait=0`, then
  `POST /api/runner/jobs/<id>/result` with `skills/pr-x-post/references/example-output.json`
  (first post; attachment `ogp` with link `http://127.0.0.1:6162/dead/page` and ogImage
  `https://img.gdgs.jp/og`). Require `sns.calls` 0.
- Blocked approval. Open the draft, clear **OGP 画像の URL**, **リンクを保存**, click **承認**,
  require **OGP-ON-SHORTLINK** and status not **承認済み**. Restore the URL and **リンクを保存**.
- Stale version. Open the draft in a second tab of the `lead` profile. In tab B change the
  link and **リンクを保存** (new version). In tab A click **承認** and require the stale-version
  message. Reload tab A, click **承認**, require **承認済み** and **短縮リンク: …**.
  Require `sns.calls` still 0.
- Own chapter. Require the @chapter2 row text. Click **@chapter1 で予約**, require
  **予約済み**. Read the fake: one chapter-1 post, actor `dev-user-lead`. Reload and confirm
  no second post after another press is impossible (the button is gone) and the count is 1.
  As `osaka`, open the draft URL, click **@chapter2 で予約**, require
  **@chapter2 に予約しました**; the new post has actor `dev-user-osaka`.
- Follow-up. `POST /dev/mock-services` with `publish=<post id>` (the fake's own control,
  standing in for X), `GET /dev/cron?name=hourly`, reload: **投稿済み**. Run hourly again;
  `/messages` holds exactly one **リンク切れ** message for the slug.

## Gotchas

The fakes keep state in memory per server run; read counts as deltas. Never use the e2e
`target-approve` HTTP shortcut: it bypasses the screen under test. The stale-version guard
was added in `0011_approved_versions.sql`; on older source the refusal does not exist and
the journey fails (see `apps/pr/docs/approval-lifecycle.md`).
