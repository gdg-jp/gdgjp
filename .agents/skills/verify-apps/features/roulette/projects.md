# Projects list and creation

An organizer sees the chapter's projects on `/` and creates one. The URL slug is fixed at
creation and becomes the public spin page.

## Sub-features

- `roulette-projects`: the empty state, the create dialog, field errors, a duplicate URL,
  the redirect to the new admin page, and the new row on the list.
- `roulette-project-chapter`: an organizer in two chapters picks the owning chapter; the list
  shows each project's chapter.

## How to get to it (user POV)

Sign in and open `http://localhost:6190/`. The page heading is 「プロジェクト」. With no
projects, the card reads 「プロジェクトがありません」 and holds the only
「プロジェクトを作成」 button; once a project exists the button moves to the page header. The
dialog 「プロジェクトを作成」 says 「抽選画面の URL は、作成したあとは変えられません。」 and has
「プロジェクト名」, 「URL」 (prefix `localhost:6190/`, hint 「英小文字・数字・ハイフン」), and
「チャプター」 only when the user has two or more chapters. Buttons: 「キャンセル」, 「作成」.

## Driving it with Orca Browser

Preconditions: the helper is ready and this is a fresh stack (no projects). Use one Orca
profile for organizer work, for example `orca tab profile create --label verify-roulette-org
--scope isolated`, and open the `organizer` fixture login from `ready.json`
(`applications.roulette.fixtureLogins.organizer.url`).

`roulette-projects`:

1. `goto` `/`. Snapshot; require heading 「プロジェクト」 and 「プロジェクトがありません」.
   Screenshot `roulette-projects-empty.png`.
2. Wait until 「プロジェクトを作成」 is enabled (it stays disabled until hydration), click it.
   Without filling anything click 「作成」. Require 「プロジェクト名を入れてください」 and
   「URL を入れてください」.
3. Fill 「プロジェクト名」 with `Verify 抽選`, fill the textbox named 「URL」 with `admin`, click
   「作成」. Require 「英小文字・数字・ハイフンで 1〜40 文字にしてください（使えない語もあります）」.
4. Fill 「URL」 with `verify-spin`, click 「作成」. Require the URL
   `http://localhost:6190/admin/verify-spin`, heading `Verify 抽選`, description
   `localhost:6190/verify-spin · dev-chapter`, and the alert 「景品を登録して、受付を始めましょう」.
5. `goto` `/`. Require one row with link text `Verify 抽選`, description containing
   `localhost:6190/verify-spin` and `抽選 0 回` and `dev-chapter`, and badge 「停止中」.
6. Open the dialog from the header button, fill 「プロジェクト名」 `Duplicate`, 「URL」
   `verify-spin`, click 「作成」. Require 「この URL はすでに使われています」 and that the URL is
   still `/`.
7. Independent check: reload `/` and require the single `Verify 抽選` row. Over HTTP, an
   anonymous `curl -s -o /dev/null -w '%{http_code}' http://localhost:6190/verify-spin` returns
   `200` (the public page exists even while closed).

`roulette-project-chapter`:

1. In a second isolated profile, open
   `/dev/login?as=verify-roulette-multi&chapter=1:dev-chapter&chapter=2:other-chapter&return_to=/`.
   Require the `Verify 抽選` row (the user belongs to its chapter).
2. Open the dialog. Require the combobox 「チャプター」 showing `dev-chapter`. Choose
   `other-chapter`, fill `Other 抽選` and `verify-other`, click 「作成」. Require the admin page
   description `localhost:6190/verify-other · other-chapter`.
3. Independent check: in the organizer profile, `goto` `/admin/verify-other`. Require the
   403 page 「アクセスできません」 / 「このプロジェクトを管理する権限がありません。」, and `/` must
   not list `Other 抽選`.

Evidence: the empty-state and list screenshots, the snapshots after each error, the final
URLs, and the curl status line.

## Gotchas

- The dialog form is `noValidate`; every error comes from the server action, so wait for the
  navigation to finish before reading the field errors.
- Upper-case input is lower-cased before validation, so `Verify-Spin` creates `verify-spin`.
  Use the duplicate step, not a case variant, to test uniqueness.
- Reserved words are `admin`, `api`, `auth`, `signin`, `signout`, `no-chapter`, `dev`,
  `new`, `assets`, `_`.
- `verify-spin` is reused by the settings, spin, and log recipes; create it once per stack.
- The `member` role is not checked anywhere: a `:member` login can create projects too. That
  matches the README's "chapter members only" wording; [access.md](access.md) records it.
