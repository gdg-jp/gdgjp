# Events, the brief, co-hosts

An organizer adds an event by name, loads or edits its brief (each save is a new version),
and adds co-host chapters. Co-hosts see the event but cannot edit the brief; other chapters
get 404.

## Sub-features

- `pr-events-empty`: a chapter with no events shows **イベントがありません** and **イベントを追加**.
- `pr-campaign-brief`: adding an event opens its thread at `/c/<slug>`; **JSON を読み込む**
  saves version 1; **保存** saves version 2.
- `pr-cohost-access`: **共催に追加** on `/c/<slug>/members` lets chapter 2 see the event and
  the brief read-only (**閲覧のみ**); chapter 3 gets HTTP 404 on `/c/<slug>`.

## How to get to it (user POV)

Sidebar **イベント** (`/events`) → **イベントを追加** → dialog **イベント名** → **追加**.
The event menu **詳細** reaches brief (`/c/<slug>/brief`) and members (`/c/<slug>/members`).

## Driving it with Orca Browser

Preconditions: `lead` signed in. Choose a unique slug such as `verify-<run>`.

- Empty. On `/events` before any event, require **イベントがありません**.
- Create. Click **イベントを追加**, fill **イベント名** with the slug, click **追加**. Require
  the URL `/c/<slug>`.
- Brief. Open `/c/<slug>/brief`. Fill **JSON で読み込む** (use `fill --value-stdin`) with
  `skills/pr-playbook/examples/briefs/devfest-kansai-2026.json`, click **JSON を読み込む**,
  and wait for **版 1 を保存しました**. Click **保存** and wait for **版 2 を保存しました**.
  Read back: `SELECT c.slug, c.created_by, count(b.version) FROM campaigns c JOIN briefs b ON
  b.campaign_id=c.id GROUP BY c.id` returns 2 versions created by `dev-user-lead`.
- Co-host. On `/c/<slug>/members` fill **チャプター ID** `2`, **チャプター名** `gdgoc-osaka`,
  click **共催に追加**, and require **gdgoc-osaka（ID 2）**. In a `cohost` profile require the
  event link on `/events` and **閲覧のみ** on the brief. In an `outsider` profile require
  HTTP 404 for `/c/<slug>` (curl with that profile's dev login cookie jar, and the Orca page).

## Gotchas

The datetime fields on other pages are native `datetime-local` inputs exposed as five
spinbuttons; focus each and `type` its digits. Chapter `auto` mode (the default) lets the
assistant queue plan and draft jobs by itself; that creates runner jobs only.
