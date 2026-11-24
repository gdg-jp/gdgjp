# Roster feature map

Roster (`apps/roster`, `roster.gdgs.jp`) is a staff shift-schedule generator. Chapter members
create an event, design its shift sheets (time slots, tracks, roles, demand), collect staff
through a public registration link, auto-generate and hand-edit the roster, and publish a
read-only view by URL.

Roster is a proof of concept. Its stages are still landing, so this map describes the source as
it stands; refresh the route table, labels, and journeys whenever a stage changes a route,
a visible label, or who can reach a screen.

Drive these journeys in the stack started by [verify-apps](../../scripts/verify-apps.mjs) at
`http://localhost:6186` (built Worker preview, fresh local D1, no seed rows). Every journey
starts as `NOT VERIFIED`; a recipe here is not execution evidence.

## Identities

All sign-ins use the local-only `/dev/login` route. The display name is `<as> (dev)` and the
email is `<as>@dev.local`. A chapter value is `<id>:<slug>[:member]`; the role suffix does not
change roster permissions (ADR: flat model, any member of the event's chapter can do everything).

| Identity | Sign-in path | Reaches |
| --- | --- | --- |
| Anonymous | none | `/apply/:token` overview, `/r/:token`, `/r/:token/s/:sheetId` |
| `owner` | `/dev/login?as=verify-roster&chapter=1:dev-chapter&return_to=<path>` | every admin screen for chapter 1 events |
| `staff` | `/dev/login?as=verify-roster-staff&chapter=2:other-chapter&return_to=<apply path>` | the apply form; admin screens for chapter 2 only |
| `staff2` | `/dev/login?as=verify-roster-staff2&chapter=2:other-chapter&return_to=<apply path>` | a second applicant, needed for the public "一緒に" check |
| `outsider` | `/dev/login?as=verify-roster-outsider&chapter=2:other-chapter&return_to=/` | `/` (empty list); 403 on chapter 1 events |
| `no-chapter` | `/dev/login?as=verify-roster-nochapter&chapter=0:none&return_to=/` | `/no-chapter` only |

`chapter=0:none` parses to no chapters. Omitting `chapter` does not produce a chapterless user:
gdg-lib then defaults to `1:dev-chapter`, which is the owner's chapter.

## Routes

| Route | Who can reach it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | Signed in with a chapter; anonymous 302 to `/signin?return_to=%2F`; chapterless 302 to `/no-chapter` | Open an event, **イベントを作成** | Empty: **最初のイベントを作成**; otherwise event cards and `N EVENTS` |
| `/events/new` | Signed in with a chapter | Fill イベント名, 開催日, 開始 (09:00), 終了 (19:00), 刻み幅 (60), **作成する** | Validation errors such as イベント名を入力してください。; success redirects to the default sheet's design |
| `/e/:id` | Members of the event's chapter; other chapters get 403 | **シフト表を追加**, per sheet **割当を開く**, **設計を編集**, **公開にする** / **非公開にする**, その他の操作 (並び順, **アーカイブ**), **スタッフを管理**, **共有画面へ** | Sheet cards with 本編 badge and 公開 / 非公開; `N件公開中` |
| `/e/:id/design` | Same as `/e/:id` | none | 302 to `/e/:id/s/default:<id>/design` |
| `/e/:id/s/:sheetId/design` | Same as `/e/:id` | シフト表設定 (**シフト表設定を保存**), フェーズと時間枠 (**フェーズを追加**), トラック (**トラックを追加**), 使う役割 (**役割を保存**, 新しい役割 + **役割を作成**, **名前を変更**), 需要 (**役割を追加**, cell **需要なし** opens the demand drawer: 最小 / 理想 / リード最小 / 初参加上限, **保存**) | 時間枠（N）; slot-loss confirmation 時間枠の設定変更を確認 |
| `/e/:id/staff` | Same as `/e/:id` | スタッフ登録URL card (**コピー**, **登録画面を開く**, ステータス select + **ステータスを更新**), **メールアドレスで代理登録**, row click opens the correction drawer (**保存**, **辞退にする**) | 募集中 / 受付停止中, 時間帯別の需給, 登録スタッフ table or まだ登録がありません。 |
| `/e/:id/roster` | Same as `/e/:id` | none | 302 to the default sheet's roster |
| `/e/:id/s/:sheetId/roster` | Same as `/e/:id` | **自動生成** / **再生成** with シード, views **スタッフ別** / **役割別** / **充足状況**, cell drawers (**追加**, **外す**), **← 元に戻す**, **やり直す →**, history **戻す** | まだ生成していません。; metrics 未充足 / 理想充足率 / 第1希望の役割 / 負荷のばらつき / 条件違反; 履歴 or まだ履歴がありません。 |
| `/e/:id/share` | Same as `/e/:id` | Per-sheet URL **コピー**, details **本編の旧URLを確認** | 公開中 / 非公開 per sheet |
| `/apply/:token` | Anyone; the form needs any signed-in user, regardless of chapter | Anonymous: **サインインして登録する**. Signed in: 表示名, 当日の連絡手段（任意）, 担当できる役割, 参加できない時間 (per sheet, **すべて解除**), 備考（任意）, **登録する** / **登録内容を更新**, **辞退する** | Overview with 募集中の役割; 募集は終了しました。 unless status is 募集中; unknown token 404 |
| `/r/:token`, `/r/:token/s/:sheetId` | Anyone, no sign-in | View tabs **スタッフ別**, **役割別**, **個人** (person select), search | シフト表はまだ公開されていません。 until the sheet is published; unknown token 404 |
| `/signin` | Anyone | none | 302 to `/api/auth/signin`, which starts OIDC against Accounts (`localhost:6173`) |
| `/no-chapter` | Signed in without a chapter | **チャプターに参加する** (links to Accounts onboarding) | GDG チャプターへの参加が必要です; members are sent back to `/` |
| `/auth/signout` | Anyone | none | Clears the session and returns to `/signin` |
| `/api/auth/*` | OIDC plumbing | none | not a screen |
| `/dev/login` | Local only (404 unless `APP_URL` is local) | fixture sign-in | 302 to `return_to` |
| `/dev/seed` | Non-production | none | JSON `{"ok":true,"seeded":[]}`; seeds nothing |

## Journeys

| Journey ID | Feature | Identity | Recipe | Status |
| --- | --- | --- | --- | --- |
| `roster-access` | Sign-in gate, chapter gate, cross-chapter 403, sign-out | Anonymous, `no-chapter`, `outsider`, `owner` | [access.md](access.md) | In map |
| `roster-event-create` | Create an event and land on its default sheet design | `owner` | [event-design.md](event-design.md) | In map |
| `roster-sheet-design` | Roles, custom role, track, phase, demand on a sheet | `owner` | [event-design.md](event-design.md) | In map |
| `roster-sheets` | Add a second sheet, publish toggle, archive | `owner` | [event-design.md](event-design.md) | In map |
| `roster-staff-apply` | Open registration, anonymous overview, self-registration, closed message | `owner`, Anonymous, `staff` | [staff-apply.md](staff-apply.md) | In map |
| `roster-staff-proxy` | Owner proxy-adds by email; that person's sign-in claims the entry | `owner`, `staff2` | [staff-apply.md](staff-apply.md) | In map |
| `roster-generate` | Auto-generate, metrics, determinism, three views, history | `owner` | [roster-generate.md](roster-generate.md) | In map |
| `roster-manual-edit` | Add a candidate into a slot, warn-and-allow on 稼働不可, undo | `owner` | [roster-generate.md](roster-generate.md) | In map |
| `roster-public-view` | Share page, unpublished message, publish, no PII, views, 404 | `owner`, Anonymous | [public-view.md](public-view.md) | In map |
| `roster-oidc-signin` | Real sign-in through Accounts OIDC | Accounts session | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
| `roster-party` | 懇親会 field and public 懇親会 view | any | none | Outside: no screen sets `events.has_party` (default 0), so the field and the view never render |
| `roster-cross-sheet-conflict` | Same-date sheet overlap: solver exclusion and **重複を承知で割り当てる** confirmation | `owner` | none | Outside for the PoC: needs two same-date overlapping sheets with assignments; covered by `app/routes/e.$id.s.$sheetId.roster.test.ts` |
| `roster-slot-loss-confirm` | Changing a sheet's time grid after demand exists asks 時間枠の設定変更を確認 | `owner` | none | Outside for the PoC: covered by `app/routes/e.$id.design.test.ts`; add a recipe when the design screen stabilises |

The map lists the user entry points that exist today. It does not cover every validation
message, reorder edge case, locale, or viewport. The Playwright suites in `apps/roster/e2e/`
are separate regression evidence and do not replace these Orca journeys.

Journeys build on each other's data in one fresh D1. Run them in table order inside one stack,
or recreate the precondition each recipe states. Record the event id, sheet ids, apply path,
and view path you obtain so later journeys can reuse them.
