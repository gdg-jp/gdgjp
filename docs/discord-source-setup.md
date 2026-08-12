# Discord source import setup (wiki.gdgs.jp)

Operator steps for Discord channel history on `/sources`. Code cannot perform
these; a second operator should be able to repeat them from this document alone.

Wiki already uses `DISCORD_BOT_TOKEN` for task reminders. Source import reuses
the **same Discord application** and adds user OAuth for the guild picker.

## 1. Developer Portal

1. Open the Discord application that owns the wiki bot (same Application ID as
   reminders / agents if you share one bot).
2. **Bot → Privileged Gateway Intents**: enable **Message Content Intent**.
   Without this, guild message bodies from the REST API are empty for many
   servers.
3. **OAuth2 → General**:
   - Copy **Client ID** → `DISCORD_CLIENT_ID`
   - Reset / copy **Client Secret** → `DISCORD_CLIENT_SECRET` (`wrangler secret put`)
4. **OAuth2 → Redirects**: add
   - Production: `https://wiki.gdgs.jp/api/discord/callback`
   - Local: `http://localhost:5177/api/discord/callback`
5. Confirm the bot token is already in wiki as `DISCORD_BOT_TOKEN`.

## 2. Bot invite permissions

The `/sources` UI builds an invite URL with:

- Scope: `bot`
- Permissions: **View Channel** | **Read Message History** (bitfield `66560`)

Server admins can use the **Invite bot** link in the Discord dialog on `/sources`.
It appears before a server is selected, and again when the selected server does not
yet have the bot (then with that guild preselected).

## 3. Local `.dev.vars`

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
```

See `wiki/.dev.vars.example`.

## 4. Connectivity check (before relying on import)

1. Complete Discord OAuth from `/sources` → Connect Discord.
2. Confirm `GET /api/discord/guilds` returns the user’s servers with
   `botInstalled` flags.
3. Invite the bot to a test guild if needed, then open channels and register one.
4. Confirm `sources.status` becomes `ready` and weekly Markdown documents appear.

If Message Content Intent is off or the bot lacks channel permissions, the
import run ends in `error` with a re-invite / Intent message — it must not
silently store empty bodies.

## 5. Out of scope for this stage

- Public / private thread history under a channel (channel messages only)
- Discord DMs
- Separating the wiki bot from the agents query bot (sharing one Application is fine)
