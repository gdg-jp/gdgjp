# Event list, event registration, and event detail

A chapter member sees every event with its claim count, and its total when they own
the event or belong to one of its chapters. They register a new event for their
chapters and open an event page whose controls depend on whether they own or organize it.

## Sub-features

- `pay-events-empty` shows the empty event list on an unseeded launch.
- `pay-events-list` lists seeded and newly created events, newest first, with claim counts and totals (`非公開` for other chapters' events).
- `pay-event-create` registers an event from **イベント登録**, rejects a blank title, and snapshots the creator's chapters.
- `pay-event-roles` shows owner, chapter organizer, plain member, and other-chapter views of one event, plus 404 for unknown or malformed IDs.

## How to get to it (user POV)

Sign in and open `/`. The page header shows **口座情報** and **イベント登録**; the region
**イベント一覧** lists events as links. **イベント登録** opens `/events/new` with the
heading **イベントを登録**, the field **イベント名**, and the button **作成する**.
Selecting an event title opens `/events/<id>`, whose back link is **イベント一覧**.

## Driving it with Orca Browser

Preconditions: the helper is ready. All journeys except `pay-events-empty` assume
`fixtures/seed.sql` was applied, which creates `Verify Seed Event`
(`evt_0000000000000000000000SEE1`, chapter 1, owner `dev-user-organizer`, claims
totaling 6,500 yen) and `Verify Google Seed Event` (`evt_0000000000000000000000SEE2`,
no claims). Sign in with the identity URL named in each step; use a separate browser
profile per identity.

- Empty list (`pay-events-empty`). Requires a launch without the seed. Sign in with
  `/dev/login?as=organizer&chapter=1:gdg-tokyo:organizer&return_to=/`. Require the
  region **イベント一覧** containing `まだイベントがありません。最初のイベントを登録してください。`
  and no table. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT COUNT(*) AS n FROM events"`
  returns `n = 0`. Evidence: snapshot, screenshot.
- Seeded list (`pay-events-list`). Sign in with
  `/dev/login?as=member&chapter=1:gdg-tokyo:member&return_to=/`. Require a table with
  column headers **イベント**, **申請数**, **合計**, a row `Verify Google Seed Event | 0 | ¥0`
  above a row `Verify Seed Event | 2 | ¥6,500`. Require links **口座情報** and
  **イベント登録**. Sign in as `outsider` and require the row
  `Verify Seed Event | 2 | 非公開`. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT e.title, COUNT(c.id) AS n, COALESCE(SUM(c.total_amount),0) AS total FROM events e LEFT JOIN claims c ON c.event_id = e.id GROUP BY e.id ORDER BY e.created_at DESC"`.
  Evidence: snapshot, screenshot.
- Blank title (`pay-event-create`). Sign in with
  `/dev/login?as=organizer&chapter=1:gdg-tokyo:organizer&chapter=3:gdg-kyoto:member&return_to=/`.
  Choose **イベント登録**. Require heading **イベントを登録** and the description text
  `現在の所属: gdg-tokyo, gdg-kyoto`. Type a single space into **イベント名** and choose
  **作成する**. Require an alert titled `イベント名を入力してください` and the URL still
  `/events/new`. Independent check: event count unchanged.
- Create (`pay-event-create`). Replace **イベント名** with `Verify Created Event` and choose
  **作成する**. Require navigation to `/events/evt_<26 characters>`, heading
  `Verify Created Event`, description `合計 ¥0`, and the region **申請一覧** with heading
  **すべての申請** and `まだ申請がありません。`. Choose **イベント一覧** and require
  `Verify Created Event` as the first row with `0` and `¥0`. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT id, owner_user_id, owner_chapter_ids, status FROM events WHERE title = 'Verify Created Event'"`
  returns one row with `dev-user-organizer`, `[1,3]`, `open`. Evidence: snapshot after
  create, the D1 row, network status of the POST (302 then 200).
- Owner view (`pay-event-roles`). As `organizer` (chapter `1:gdg-tokyo:organizer`), open
  `/events/evt_0000000000000000000000SEE1`. Require heading `Verify Seed Event`,
  `合計 ¥6,500`, a disabled **経費を申請** button, a **代行登録** link, the status
  `口座情報の登録が必要です`, the **Google連携** card, heading **すべての申請**, and two rows:
  `検証 代行花子（架空） | 代行 | ¥4,500 | 下書き` and
  `検証 メンバー太郎（架空） | 本人 | ¥2,000 | Sheets同期済`, each with **開く**.
- Chapter organizer view (`pay-event-roles`). Sign in with
  `/dev/login?as=coorganizer&chapter=1:gdg-tokyo:organizer&return_to=/` and open the same
  event. Require the same two rows, **代行登録**, and the **Google連携** card.
- Plain member view (`pay-event-roles`). As `member` (chapter `1:gdg-tokyo:member`), open
  the same event. Require heading **自分の申請** with only the `検証 メンバー太郎（架空）`
  row, a **自分の申請** link to `/events/evt_0000000000000000000000SEE1/claims/clm_0000000000000000000000SEC2`,
  no **代行登録**, and no **Google連携** card. Record that the description still reads
  `合計 ¥6,500`.
- Other-chapter organizer view (`pay-event-roles`). Sign in with
  `/dev/login?as=outsider&chapter=2:gdg-osaka:organizer&return_to=/`. Require both seeded
  events on `/`. Open the seeded event and require heading **自分の申請**,
  `まだ申請がありません。`, no **代行登録**, no **Google連携** card, and no `合計` description
  under the heading. Independent check: the page HTML from a curl jar for `outsider`
  does not contain `6500` or `6,500`.
- Not found (`pay-event-roles`). As `member`, navigate to `/events/not-an-id` and to
  `/events/evt_0000000000000000000000ZZZZ`. Require HTTP 404 for both. Evidence for the
  role views: one snapshot per identity and the network status of each navigation.

## Gotchas

- The seed makes the empty state unreachable. Run `pay-events-empty` on a separate,
  unseeded launch, or record it as not reachable in this run. Do not delete rows to
  fake it.
- The list shows every event to every member of any chapter. The event total is shown
  only to the event's owner and to members (any role) of the chapters the event
  snapshotted, so a plain member of the event's chapter sees the full total while
  seeing only their own claim. Members of other chapters see `非公開` in the list and no
  total on the event page.
- A new event snapshots all of the creator's chapters, including ones where the creator is
  only a member. Organizers of those chapters gain management of the event.
- Do not choose **自分のGoogleアカウントで連携する** on the event page. It navigates to
  `accounts.google.com`. The Google card is covered by [Google connection](google.md).
- Events have no edit, close, or delete UI. The `status` column is always `open`.
