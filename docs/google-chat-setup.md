# Google Chat setup (wiki source ingestion)

Operator guide for Stage 2 — ingesting selected Google Chat Spaces into the wiki
`sources` raw layer. Implementation talks to the Chat API with **user OAuth**; Workspace
admin / Vault access is not required.

## Google Cloud Console

1. Open the same Google Cloud project that already powers wiki Google Drive / Docs
   (`GOOGLE_DOCS_CLIENT_ID` / `GOOGLE_DOCS_CLIENT_SECRET`).
2. Enable **Google Chat API**
   ([API library](https://console.cloud.google.com/apis/library/chat.googleapis.com)).
3. Enable **People API**
   ([API library](https://console.cloud.google.com/apis/library/people.googleapis.com)). Wiki
   uses it to resolve Chat `users/...` sender resources to directory display names.
4. Configure a **Chat app** under Google Chat API → Configuration. A Chat app entry is
   required even when the Worker only uses user authentication and never posts as a bot.
   Minimal settings are enough (app name + avatar); interactive features are unused.
5. Under APIs & Services → Credentials → the OAuth client used by wiki, confirm the
   authorized redirect URI includes:

   `https://<wiki-host>/api/google-drive/callback`

   Locally that is typically `http://localhost:5177/api/google-drive/callback`.
6. OAuth consent screen: add (or verify) these scopes so the consent UI can request them:

   - `https://www.googleapis.com/auth/chat.spaces.readonly`
   - `https://www.googleapis.com/auth/chat.messages.readonly`
   - `https://www.googleapis.com/auth/directory.readonly`

   Drive / Forms scopes already used by wiki stay in place. `directory.readonly` permits
   directory-name lookups; Workspace policies may require an administrator to allow the scope
   and directory-profile sharing. When a lookup is unavailable, imported Markdown explicitly
   labels the sender as `Unknown user (users/...)` rather than using an unverified Chat payload.

## Connectivity check (manual)

Do this with a personal access token that includes the Chat and directory scopes above (for example
from [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) against the
same Cloud project, or after reconnecting Google on `/sources`).

```bash
# 1. Spaces the user participates in
curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  'https://chat.googleapis.com/v1/spaces?pageSize=10'

# 2. Messages in one space (replace SPACE_ID)
curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  'https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?pageSize=10'

# 3. Sender name lookup (replace ACCOUNT_ID from users/ACCOUNT_ID)
curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  'https://people.googleapis.com/v1/people/ACCOUNT_ID?personFields=names&sources=READ_SOURCE_TYPE_PROFILE'
```

All calls must return HTTP 200. If they fail (403 / API not enabled / app not configured /
directory sharing blocked), fix the Console setup before relying on wiki ingestion. A Takeout
JSON upload fallback is a separate product decision and is out of scope for Stage 2.

## Wiki operator steps after deploy

1. Apply all pending wiki migrations, including `0034_google_chat_ingestion.sql` and
   `0035_source_fetch_attempt.sql` (`pnpm --filter @gdgjp/wiki migrate:local` or remote
   equivalent).
2. On `/sources`, disconnect Google if the account was linked before Chat scopes existed,
   then **Connect Google** again and approve the Chat and directory scopes on the consent screen.
3. Use **Load spaces you belong to**, pick one Space, choose a chapter, and add it.
4. Confirm monthly `source_documents` (`YYYY-MM`) and Markdown headings of the form
   `## [YYYY-MM-DD HH:mm] Display Name`.
5. Post a new Chat message, refresh the source, and verify only the current month’s
   `content_hash` changes.

Tokens without the Chat or directory scopes surface a reconnect instruction on the source row
instead of silently failing the fetch.
