# deck access and sign-out

Every deck screen and API needs a session whose chapters include the deck's chapter. Another
chapter's member gets 404, not 403, so deck IDs do not leak. The dock is the only page reached
by token alone.

## Sub-features

- `deck-access`: anonymous redirect; chapterless page; an other-chapter member sees an empty
  list and 404 on the deck's phone page, editor, layout save, image, and deck actions; a wrong
  dock token shows **この URL は使えません。…**.
- `deck-signout`: **Account menu** → **ログアウト** clears the session.

## How to get to it (user POV)

Open `http://localhost:6189/`. Without a session the app sends the visitor to sign in. A member
sees the heading **デッキ**. Sign-out is in the account menu at the top right.

## Driving it with Orca Browser

Preconditions: `deck-create` has made a chapter 1 deck (record `DECK` = its id) with one image
key from `deck-key-look` (record `IMG` = its image id). Profiles: `deck-anon`, `deck-member`,
`deck-outsider`, `deck-nochapter`. For HTTP checks, sign in with curl into a cookie jar:
`curl -s -c outsider.jar -o /dev/null '<outsider fixtureLogin URL>'` (keep the jar in the
scratch directory; never retain it).

- Anonymous. `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://localhost:6189/`
  prints `302 http://localhost:6189/signin?return_to=%2F`; `/d/$DECK` prints a 302 to
  `/signin?return_to=%2Fd%2F$DECK`. In `deck-anon`, `goto` `/` with capture on and require the
  chain `/` → `/signin?return_to=%2F` → `/api/auth/signin?return_to=%2F`; stop before Accounts.
- Wrong dock token. In `deck-anon`, `goto /dock/$DECK?t=wrong` and `/dock/missing?t=invalid`.
  Both render **この URL は使えません。デッキの編集画面から新しいドックの URL をコピーしてください。**
  with HTTP 200. Screenshot one.
- Chapterless. In `deck-nochapter`, open the `no-chapter` fixture login. Require `/no-chapter`,
  **GDG チャプターへの参加が必要です**, and a link **accounts.gdgs.jp** to Accounts `/onboarding`.
- Other chapter, browser. In `deck-outsider`, open the `outsider` fixture login. Require heading
  **デッキ** and **まだデッキがありません。** (the chapter 1 deck is not listed). `goto /d/$DECK` and
  `goto /decks/$DECK/edit`: both show the error boundary with status 404 (`orca network` shows
  the document 404). Screenshot.
- Other chapter, HTTP. With `outsider.jar`:
  `curl -s -b outsider.jar -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"version":1,"layout":{}}' http://localhost:6189/api/decks/$DECK/layout`
  prints `404`; `curl -s -b outsider.jar -o /dev/null -w '%{http_code}' http://localhost:6189/images/$DECK/$IMG`
  prints `404`; `curl -s -b outsider.jar -o /dev/null -w '%{http_code}' --form-string intent=rename --form-string deckId=$DECK --form-string name=x http://localhost:6189/api/decks`
  prints `404`. The same image request with the member's jar prints `200`, and the deck name is
  unchanged on the member's home page afterwards.
- Second member. In a `deck-member2` profile, sign in as `member2`. Require the deck on `/`
  with **編集**, and `/decks/$DECK/edit` renders (the `:member` role has full access).
- Sign-out (`deck-signout`, last). In `deck-member`, on `/`, click **Account menu**, then
  **ログアウト**. Require `/auth/signout` → `/signin` → `/api/auth/signin?...` in capture. Then
  `goto http://localhost:6189/api/auth/me` in that profile and require `{"user":null}`.
- Evidence: curl status lines, sanitized network chains, snapshots of the empty list and the
  dock error, and a screenshot of the 404 page.

## Gotchas

The dev sessions bypass Accounts; the redirect chain ends at the Accounts origin, which this
stack does not serve, so a connection error there is expected. An outsider never sees the
deck id in the UI; take it from the member's editor URL. The phone page's room socket is gated
again on connect (401 for non-members), but the loader's 404 already stops the page, so the
socket check is not separately observable in the browser. Sign-out ends the `deck-member`
session; sign in again if any journey follows.
