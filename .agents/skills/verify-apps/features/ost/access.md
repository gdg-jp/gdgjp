# Access and dashboard

Admin surfaces need a session with the event's chapter; the participant page is public.

## Sub-features

- `ost-gate`: anonymous `/<slug>/screen` 302s to `/signin`.
- `ost-chapter-isolation`: an outsider's dashboard omits chapter 1 events; their admin pages are 403.
- `ost-unknown-event`: an unknown slug is 404.
- `ost-dashboard`: create an event; a taken slug is rejected.

## How to get to it (user POV)

Organizers open `/`. Participants open `/<slug>` from a QR code.

## Driving it with Orca Browser

- Gate: `curl -o /dev/null -w '%{http_code} %{redirect_url}' http://localhost:6185/verify-ost/screen`
  gives 302 to `/signin?return_to=%2Fverify-ost%2Fscreen`. In a fresh profile `goto` the same
  URL and record the final URL.
- Dashboard: owner fixture login with `return_to=/`. Fill **イベント名** `Verify Created`,
  **URL（ost.gdgs.jp/◯◯◯）** `verify-created`, click **作成する**, reload: `Verify Created` has
  its four links. Submit the same slug again; require alert
  `URL「verify-created」は既に使われています。`.
- Isolation: outsider fixture login in another profile. Require `まだイベントがありません。` and
  no `Verify OST`. `goto /verify-ost/edit`; require `403 Forbidden`. Independent check with a
  `curl` fixture login: `/verify-ost/edit`, `/screen`, `/tables` all 403.
- Unknown event: `curl` `/definitely-not-an-event` is 404; `goto` it and screenshot.

## Gotchas

Without Accounts the sign-in redirect ends at `/api/auth/signin` with the 503 page **サインインサービスに接続できませんでした**. The
`outsider` probe text is the chapter slug in loader data, because the dashboard renders on
the client.
