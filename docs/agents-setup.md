# agent.gdgs.jp operator setup

Manual steps for running [Stage 5](plans/05-agents-gdgs-jp.md) (`agents/` on Vercel).
Code cannot perform these; a second operator should be able to repeat them from this document alone.

## 1. Google Chat app

1. In Google Cloud Console, open (or create) the project that will own the Chat app.
2. Enable **Google Chat API**.
3. Open **Google Chat API → Configuration** and create/configure the app:
   - **Connection settings**: HTTP endpoint URL
   - **App URL**: `https://agent.gdgs.jp/api/chat`
   - Enable receiving 1:1 messages and joining spaces as needed
4. Note the Cloud project **number** (not the project id string). That number is the JWT `aud` claim
   Chat sends on every webhook.
5. Set Vercel env `GOOGLE_CHAT_AUDIENCE` to that project number exactly.
6. Create a service account for posting replies (or use ADC in constrained environments). Put the JSON
   key in `GOOGLE_CHAT_CREDENTIALS`, or set `GOOGLE_CHAT_USE_ADC=true` where ADC is available.

Local verification tip: Chat SDK can forward webhooks through a tunnel; the production URL above must
still match what is registered in the Chat API console (scheme, host, path — no trailing slash drift).

## 2. Discord application

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **General Information**, copy the **Public Key** → Vercel `DISCORD_PUBLIC_KEY`.
3. Copy **Application ID** → `DISCORD_APPLICATION_ID`.
4. Create a bot user and copy the bot token → `DISCORD_BOT_TOKEN`.
5. Set **Interactions Endpoint URL** to `https://agent.gdgs.jp/api/chat`.
   Discord validates with a signed PING; a bad signature must return 401 (the agents verifier does this).
6. Invite the bot using an OAuth2 URL that includes both the `bot` and `applications.commands` scopes.
   The production deployment synchronizes `/unlink` with Discord automatically after the deploy succeeds;
   no manual API call is needed. For an already invited bot, reauthorize it with the updated URL if the
   `applications.commands` scope was omitted, then reload the Discord client before checking the command
   picker.

Google Chat has no Chat SDK slash-command surface; members type `/unlink` as a message there.

## 3. Vercel project

1. Create a **new** Vercel project for agents (do not reuse the tinyurl-gateway project).
2. In the monorepo GitHub app settings on Vercel, set **Root Directory** to `agents` (the deploy
   workflow runs Vercel from the repo root so workspace packages resolve).
3. Region: `hnd1` (see `agents/vercel.json`).
4. Add every environment variable from the table below to Production (and Preview if you use it).
5. In GitHub Actions repository secrets, set **`VERCEL_PROJECT_ID_AGENTS`** to this project's id.
   The existing `VERCEL_PROJECT_ID` secret belongs to tinyurl-gateway — reusing it deploys agents into
   the wrong project. The agents deploy step reads only `VERCEL_PROJECT_ID_AGENTS`
   (see `.github/workflows/deploy.yml`).

## 4. Environment variables

| Variable | Purpose |
|---|---|
| `IDP_CLIENT_ID` | OAuth client id (`agents`) |
| `IDP_CLIENT_SECRET` | OAuth client secret (must match accounts seed) |
| `ACCOUNTS_URL` | `https://accounts.gdgs.jp` |
| `REDIS_URL` | Redis for Chat SDK state, webhook replay, and link records |
| `WIKI_API_URL` | `https://wiki.gdgs.jp` — agent API base |
| `WIKI_PUBLIC_URL` | Optional; citation links (defaults to `WIKI_API_URL`) |
| `GOOGLE_CHAT_AUDIENCE` | Chat app project number (JWT aud) |
| `GOOGLE_CHAT_CREDENTIALS` | Service-account JSON, or use ADC |
| `GOOGLE_CHAT_USE_ADC` | `true` when using Application Default Credentials |
| `DISCORD_PUBLIC_KEY` | Ed25519 public key (hex) |
| `DISCORD_BOT_TOKEN` | Bot token |
| `DISCORD_APPLICATION_ID` | Application id |
| `TOKEN_ENCRYPTION_KEYS` | AES-256-GCM keyring JSON (see below) |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (OIDC may replace this on Vercel) |
| `AGENT_MODEL` | Optional model id (default `google/gemini-2.5-flash`) |

Also required on accounts.gdgs.jp (not Vercel): `AGENTS_CLIENT_SECRET`, then
`POST /admin/seed-clients` after deploy so redirect URI
`https://agent.gdgs.jp/auth/callback` is seeded.

## 5. `TOKEN_ENCRYPTION_KEYS`

Generate a 32-byte key and store it as a JSON map of version → base64:

```bash
node -e 'console.log(JSON.stringify({ "1": require("crypto").randomBytes(32).toString("base64") }))'
```

Put the entire JSON string in the Vercel env value (no extra quotes wrapping in the dashboard).

**Rotate a key**

1. Generate a new version, e.g. `{"1":"<old>","2":"<new>"}`.
2. Deploy. New encrypts use the highest numeric version; decrypt still accepts old versions.
3. Existing links keep working. After refresh or re-link, ciphertext moves to the current version.
4. Remove an old version only when no Redis link records still reference it.

Never log decrypted tokens or the keyring.

## 6. DNS — `agent.gdgs.jp` → Vercel

1. Deploy the Vercel project once and note the assigned `*.vercel.app` hostname (or follow Vercel's
   custom-domain instructions for the project).
2. In Cloudflare DNS for `gdgs.jp`, add the record Vercel requests for `agent` (usually CNAME to
   `cname.vercel-dns.com`, or an A/AAAA set Vercel shows).
3. In the Vercel project → Domains, attach `agent.gdgs.jp` and wait until SSL is issued.
4. Confirm:
   - `https://agent.gdgs.jp/api/chat` rejects unsigned POSTs with 401
   - `https://agent.gdgs.jp/auth/callback` serves the linking result page

## 7. Smoke checklist

1. Unlinked Google Chat mention → linking URL; Wiki logs show no `/api/agent/*` request.
2. Complete OAuth → ask again → answer with wiki page citations.
3. Tool trace starts with `wiki_cat` `/wiki/index`, then `wiki_ls` / `wiki_cat` (not a lone search).
4. Restricted page invisible to the member is neither cited nor quoted.
5. Second member with different access gets a different answer where permissions differ.
6. “Please read this Doc too” → multi-chapter user is asked for a chapter; `POST /api/agent/sources`
   uses the chosen chapter only.
7. `/unlink` (Discord slash or Google Chat message) → next question returns a linking URL again.
8. Repeat 1–6 on Discord with that platform’s user id.
