# Schedule and derived reminders

The schedule lists posts, mails, asks, and reminders. Adding a post derives a staff reminder
one hour before it; a blocked-by condition shows what the post waits for.

## Sub-features

- `pr-schedule-derived`: adding an X post at 18:00 with condition
  `session:never-confirmed:confirmed` shows two rows: the post with
  **待ち: セッション「never-confirmed」の確定**, and **スタッフへいいね・リポストの依頼** at 17:00.
  Editing the post to 19:00 moves the reminder to 18:00.

## How to get to it (user POV)

Event menu **予定表** (`/c/<slug>/schedule`) → **アイテムを追加**.

## Driving it with Orca Browser

Preconditions: `lead`, an event with a brief.

- Add. Click **アイテムを追加**. For **日時**, focus the `Year`, `Month`, `Day`, `Hours`,
  `Minutes` spinbuttons in turn and type `2026`, `10`, `07`, `18`, `00`. Fill **タイトル**
  `セッション紹介` and **告知開始の条件** `session:never-confirmed:confirmed`. Click **追加**.
- Observe. Read `li[data-item-id]` texts with `eval` (read only). Require the two rows above.
- Edit. Click the first row's **編集**, change `Hours` to `19`, click **保存**, and require the
  reminder row at 18:00.

## Gotchas

`fill` on a `datetime-local` input fails in Orca ("no focused editable element"); use the
spinbuttons. Typing all digits into `Year` puts them all in the year field.
