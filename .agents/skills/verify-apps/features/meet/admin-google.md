# Google connection settings (admin)

An administrator checks whether the shared host account is connected, starts the OAuth
connection, refreshes the Workspace Events subscription, and retries failed artifact jobs. In
the local stack OAuth is not configured, so this page proves the unconfigured state and the
callback's error reporting only.

## Sub-features

- `meet-admin-google` page: heading **Google 接続設定**, warning **Google OAuth 環境変数が未設定です**,
  card 共有ホストアカウント接続 with badge 未接続, 接続対象アカウント `community-support@gdgoc.jp`,
  text まだ Google アカウントが接続されていません。…, disabled **Google アカウントを接続**.
- Card **Workspace Events 購読状態**: badge 未登録, 通知先トピック `projects/gdgs-meet/topics/meet-events`,
  まだ Workspace Events 購読が登録されていません。…, disabled **購読を今すぐ確認・更新**.
- Card **失敗・未完了の生成ファイルジョブ** with `0 件` and 失敗または未完了の生成ファイルジョブはありません。
- Callback error flashes: `/admin/google/callback` without `state` redirects to
  `/admin/google?error=missing_state`; an unknown `state` gives `error=state_invalid`; the page
  shows alert **Google 接続に失敗しました** with the mapped message.
- Admin navigation: sidebar link **Google 接続設定** and, on `/`, the link
  **Google 接続設定を開く** inside the unconnected alert.

## How to get to it (user POV)

Sign in as an administrator, open `/`, and click **Google 接続設定** in the sidebar or
**Google 接続設定を開く** in the alert.

## Driving it with Orca Browser

Identity: `admin`, signed in with
`/dev/login?as=verify-meet-admin&chapter=1:dev-chapter&admin=1&return_to=/` in its own isolated
profile. Precondition: fresh stack; no `google_connection` or `google_subscription` row.

- Entry. Require on `/` the sidebar link **Google 接続設定** and the alert link
  **Google 接続設定を開く**. Click the sidebar link; require URL `/admin/google`, heading
  **Google 接続設定**, and the page title `Google 接続設定 — GDG Japan Meet`.
- Unconfigured state. Require alert **Google OAuth 環境変数が未設定です**, badge **未接続**,
  `community-support@gdgoc.jp`, and button **Google アカウントを接続** disabled with an
  `img[src="/icons/google-logo.svg"]` inside it (`naturalWidth > 0` via `orca eval`).
- Subscription and jobs. Require heading **Workspace Events 購読状態**, badge 未登録, topic
  `projects/gdgs-meet/topics/meet-events`, no alert **PUBSUB_PUSH_SERVICE_ACCOUNT が未設定です** (the
  service account comes from `wrangler.toml`), button **購読を今すぐ確認・更新** disabled, heading
  **失敗・未完了の生成ファイルジョブ** with `0 件` and 失敗または未完了の生成ファイルジョブはありません。
  Screenshot.
- Callback errors. `goto /admin/google/callback`. Require final URL
  `/admin/google?error=missing_state` and alert **Google 接続に失敗しました** containing
  認可状態のパラメータが見つかりませんでした。もう一度接続を実行してください。 `goto
  /admin/google/callback?state=verify-bogus&code=x`. Require `?error=state_invalid` and
  認可セッションの検証に失敗しました（期限切れ・再送信・別セッション）。もう一度接続を実行してください。
- Admin sees all meetings. If [meeting-detail.md](meeting-detail.md) seeded D1, `goto /` and require
  **検証 非公開の会議** listed; `goto /meetings/verify-hidden` and require its heading and the
  **編集** link (admins hold the edit role on every active meeting).

Independent check: with a `curl -c` admin jar (same `/dev/login` URL), `GET /admin/google` returns
200 containing `Google OAuth 環境変数が未設定です`; `GET /admin/google/callback` returns 302 with
`Location: /admin/google?error=missing_state`. In D1, `SELECT COUNT(*) FROM google_oauth_state`
stays 0 because no connect action ran.
Evidence: screenshots of the page and of each callback error alert, the two callback redirects.

## Gotchas

Do not POST the connect form by HTTP to get past the disabled button: with OAuth unconfigured it
only redirects to `?error=missing_config`, and with a configured client it would send the
browser to Google. `/admin/google?status=connected` renders **Google アカウントを接続しました** from
the query string alone; it is not evidence of a connection. **再試行** appears only for seeded
failed `artifacts` rows and enqueues `share_artifact`, which then calls Drive without a token;
it is outside this map.

`/dev/simulate-event` (POST JSON, loopback only) bypasses only Pub/Sub delivery and JWT
verification. Locally, `{}` answers `{"ok":true,"action":"invalid_envelope"}`, an envelope whose
`message.attributes["ce-type"]` is unknown answers `ignored_event_type`, and any conference,
recording, transcript, or smart-note event answers HTTP 500 `{"ok":false,"action":"error"}`
because the handler fetches the conference record from the Meet API with the shared Google
token. Use it only as an HTTP smoke check, never as evidence of event processing.
