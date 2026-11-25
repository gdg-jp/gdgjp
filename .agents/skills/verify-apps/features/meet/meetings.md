# Home and meeting creation form

A chapter member lands on the meeting list, sees that the shared Google account is not
connected, opens **新しい会議**, fills the form, toggles automatic recording settings, and checks
the invitee count before creating. Creation itself needs Google and stays disabled locally.

## Sub-features

- `meet-home`: `/` with heading **GDG Japan Meet**, warning alert **共有 Google アカウントが未接続です**
  (管理者が共有 Google ホストアカウントを接続するまで、会議を作成できません。), empty state
  **まだ会議がありません**, link **新しい会議** only for chapter members, sidebar **会議一覧**,
  **テーマを切り替える** (ライト / ダーク / システム radios), and the Google Workspace logos
  under `/icons/*.svg`.
- `meet-create-form`: `/meetings/new` heading **新しい会議を作成**, the same unconnected alert,
  fields 会議タイトル, 日付, 開始時刻, 終了時刻, タイムゾーン, 説明, 主催チャプター, the checkbox
  主催チャプターの Organizer を共同主催者（co-host）として招待する (checked), アクセスの種類 radios
  制限付き（招待者のみ） (selected) / 信頼済み（組織内 + 招待者） / 公開（リンクを知っている全員）,
  自動記録設定 checkboxes, **他チャプターを追加**, **キャンセル**, and a disabled **会議を作成**.
- `meet-invitee-preview`: **人数を確認** under 招待者数の事前確認 returns counts (作成者, 主催チャプター,
  他チャプター, 個別メール, 重複統合後 合計) or an alert **招待者数の確認エラー**.

## How to get to it (user POV)

Sign in and open `http://localhost:6193/`. Click **新しい会議**. The back link **会議一覧へ戻る**
and **キャンセル** return to `/`.

## Driving it with Orca Browser

Identity: `member`. Precondition: fresh stack, no meetings, no Google connection.

- Home. `goto /dev/login?as=verify-meet&chapter=1:dev-chapter&return_to=/`. Require heading
  **GDG Japan Meet** (level 1), the alert title **共有 Google アカウントが未接続です**, text
  **まだ会議がありません** and 作成または招待された Google Meet 会議がここに表示されます。, and link
  **新しい会議**. Require no **Google 接続設定** link (non-admin). Screenshot.
- Theme. Click **テーマを切り替える**, then menu item radio **ダーク**. Require
  `orca eval "document.documentElement.classList.contains('dark')"` to be `true` and
  `orca eval "document.documentElement.scrollWidth <= innerWidth"` to be `true`. Switch back with
  **ライト**.
- Logos. HTTP `GET` each of `/favicon.svg`, `/icons/google-meet.svg`, `/icons/google-calendar.svg`,
  `/icons/google-logo.svg`, `/icons/google-docs.svg`, `/icons/google-drive-video.svg`; require 200
  and `content-type` matching `image/svg+xml`. In Orca require
  `document.querySelector('a[href="/"] img[src="/icons/google-meet.svg"]').naturalWidth > 0`.
- Create form. Click **新しい会議**. Require URL `/meetings/new`, heading **新しい会議を作成**, the
  unconnected alert, a 会議タイトル textbox, 主催チャプター showing `dev-chapter` (directory is
  unreachable, so the slug is the label), the 主催チャプターの Organizer を共同主催者（co-host）として招待する
  checkbox checked, the 制限付き（招待者のみ） radio checked, and button **会議を作成** disabled.
  Require 日付 / 開始時刻 / 終了時刻 prefilled (non-empty values).
- Auto-record toggles. Require checkbox **文字起こし（自動開始）** checked,
  **Gemini Notes（自動開始）** checked, **録画・チャット保存（自動開始）** unchecked. Click 文字起こし and
  録画・チャット保存; require 文字起こし unchecked, Gemini Notes still checked, 録画 checked.
- Add-chapter row. Click **他チャプターを追加**. Require three comboboxes **招待するチャプター**
  (`dev-chapter`), **招待対象の範囲** (Organizer のみ), **招待者の役割** (参加者), and a button
  **このチャプター招待を削除**. Click it and require the row gone and the hint text
  他のチャプターの Organizer や Member をまとめて招待したい場合は… back.
- Preview counts. Uncheck 主催チャプターの Organizer を共同主催者（co-host）として招待する. Fill
  個別に招待する共同主催者（co-host）のメールアドレス with `cohost@example.com` and
  個別に招待する参加者のメールアドレス with `a@example.com, b@example.com`. Click **人数を確認**.
  Require 作成者 `1 名`, 主催チャプター `0 名`, 他チャプター `0 名`, 個別メール `3 名`, and
  重複統合後 合計 `4 名（共同主催者 2 名 / 参加者 2 名）`.
- Preview validation. Replace the participant field with `not-an-email`, click **人数を確認**;
  require alert **招待者数の確認エラー** with
  メールアドレスの形式が正しくありません: not-an-email. Replace it with `team@googlegroups.com`;
  require Google グループ（googlegroups.com）は招待先に指定できません: team@googlegroups.com.
- Directory failure. Clear both email fields, re-check the host-organizer checkbox, click
  **人数を確認**. Require **招待者数の確認エラー** with
  チャプターメンバーの取得に失敗しました。時間をおいて再度お試しください。
- Leave. Click **キャンセル**; require URL `/`.

Independent check: mint a member cookie with `curl -c` against the `/dev/login` URL. `GET /` and
require `新しい会議` and `まだ会議がありません` in the body; `GET /meetings/new` and require
`新しい会議を作成` and `共有 Google アカウントが未接続です`. After the journey, require the D1
`meetings` table to be empty: in the snapshot's `apps/meet` (`scratch` from `ready.json`), run
`pnpm exec wrangler d1 execute gdgjp-meet-db --local --command "SELECT COUNT(*) AS n FROM meetings"`
and require `n` = 0, proving the preview never wrote a meeting.
Evidence: screenshots of `/`, the filled form with preview counts, and each error alert.

## Gotchas

**会議を作成** is disabled because no `google_connection` row exists; do not insert one to enable
it, because `createMeeting` would then call the real Meet and Calendar APIs. The directory
failure message is the expected local outcome, not a defect: the host-organizer source needs the
`ACCOUNTS_DIRECTORY` RPC. With `--accounts` the RPC exists but the dev user has no Accounts
identity, so the result may instead be the `forbidden` variant
チャプターメンバーの取得には、いずれかのチャプターへの所属が必要です。…; record whichever appears. Preview counts never include member emails; the creator is always one co-host. The
date and time defaults depend on the current time, so do not assert exact values.
