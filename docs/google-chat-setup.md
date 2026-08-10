# Google Chat setup (wiki source ingestion)

Operator guide for Stage 2 — ingesting selected Google Chat Spaces into the wiki
`sources` raw layer. Implementation talks to the Chat API with **user OAuth**; Workspace
admin / Vault access is not required.

## Google Cloud Console

1. Open the same Google Cloud project that already powers wiki Google Drive / Docs
   (`GOOGLE_DOCS_CLIENT_ID` / `GOOGLE_DOCS_CLIENT_SECRET`).
2. Enable **Google Chat API**
   ([API library](https://console.cloud.google.com/apis/library/chat.googleapis.com)).
3. Configure a **Chat app** under Google Chat API → Configuration. A Chat app entry is
   required even when the Worker only uses user authentication and never posts as a bot.
   Minimal settings are enough (app name + avatar); interactive features are unused.
4. Under APIs & Services → Credentials → the OAuth client used by wiki, confirm the
   authorized redirect URI includes:

   `https://<wiki-host>/api/google-drive/callback`

   Locally that is typically `http://localhost:5177/api/google-drive/callback`.
5. OAuth consent screen: add (or verify) these scopes so the consent UI can request them:

   - `https://www.googleapis.com/auth/chat.spaces.readonly`
   - `https://www.googleapis.com/auth/chat.messages.readonly`

   Drive / Forms scopes already used by wiki stay in place. User-authenticated Chat responses only
   populate `sender.name` and `sender.type`; the importer therefore records human senders as
   `Unknown user (users/...)` until a supported identity source is implemented. It does not call
   the People API or Workspace directory as a fallback.

## Connectivity check (manual)

Do this with a personal access token that includes the Chat scopes above (for example
from [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) against the
same Cloud project, or after reconnecting Google on `/sources`).

```bash
# 1. Spaces the user participates in
curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  'https://chat.googleapis.com/v1/spaces?pageSize=10'

# 2. Messages in one space (replace SPACE_ID)
curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  'https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?pageSize=10'

```

Both Chat calls must return HTTP 200. For failures such as 403, a disabled API, or an unconfigured
Chat app, inspect the structured Chat API error logs. A Takeout JSON upload path is a separate
product decision and is out of scope for Stage 2.

## Wiki operator steps after deploy

1. Apply all pending wiki migrations, including `0034_google_chat_ingestion.sql` and
   `0035_source_fetch_attempt.sql` (`pnpm --filter @gdgjp/wiki migrate:local` or remote
   equivalent).
2. On `/sources`, disconnect Google if the account was linked before Chat scopes existed,
   then **Connect Google** again and approve the Chat scopes on the consent screen.
3. Use **Load spaces you belong to**, pick one Space, choose a chapter, and add it.
4. Confirm monthly `source_documents` (`YYYY-MM`) and Markdown headings of the form
   `## [YYYY-MM-DD HH:mm] Unknown user (users/...)` for human senders.
5. Post a new Chat message, refresh the source, and verify only the current month’s
   `content_hash` changes.

Tokens without the Chat scopes surface a reconnect instruction on the source row
instead of silently failing the fetch.
