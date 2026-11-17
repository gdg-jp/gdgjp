# Discord bot: drop DM/mention triggers, add guild-shared login

> Generated from Claude Code plan: `/Users/hari/.claude/plans/regarding-the-discord-bot-dreamy-moler.md`

## Goal

Discord bot: drop DM/mention triggers, add guild-shared login

## Repo context

`agents/` (`@gdgjp/agents`, a Next.js app on Vercel) runs both a Discord bot and a Google Chat
bot through the [Chat SDK](https://www.npmjs.com/package/chat) (`agents/lib/agent.ts`,
`agents/lib/adapters.ts`). Its history shows a same-day back-and-forth: commit `ef6b646` added a
Discord Gateway listener so @mentions/DMs could trigger the assistant, then commit `7368a49`
reverted it in favor of Discord's `/ask` slash command, because the Gateway path needed the
privileged Message Content Intent. The DM/mention/subscribed-message handlers
(`bot.onNewMention`, `bot.onSubscribedMessage`, `bot.onDirectMessage`) are still wired up for the
Discord `Chat` instance today even though nothing can deliver those events without the (removed)
Gateway connection — they're vestigial and invite the same feature from creeping back in. The
user wants this formalized: Discord should answer only through slash commands, never through
plain-message DMs or mentions.

Separately, every Discord member currently has to link their own GDG Accounts credentials before
asking a question (`handleInquiry` → `getLinkedToken` → `needs_link`). The user wants a
lighter-weight model for Discord servers: whoever links first in a given server becomes that
server's shared credential — other members who haven't linked themselves can just ask, and the
bot answers using the first linker's Wiki access, instead of every member being individually
walled off until they link.

Finally, `/unlink` (`agents/discord-commands.json`, `UNLINK_COMMAND` in
`agents/lib/agent.ts:369-380`) is being replaced by an explicit `/login` command, since linking is
becoming a named, discoverable action rather than something that only ever happens implicitly
when an unlinked user asks a question.

This is Discord-only. Google Chat keeps its existing mention/DM/subscribed-message flow and its
text-based `/unlink` — nothing here touches `isUnlinkCommandText`/`handleUnlink` or the shared
`reply` closure's Google Chat behavior.

## Acceptance criteria

(no Approach / Plan / Implementation section in the source plan)

## How to verify

1. `pnpm --filter @gdgjp/agents test` (Vitest: `agent.test.ts`, `link-account.test.ts`,
   `sync-discord-commands.test.mjs`, plus the rest of the suite untouched).
2. `pnpm --filter @gdgjp/agents typecheck` (or `pnpm typecheck` at the root) since `link-account.ts`
   and `agent.ts` signatures change.
3. `pnpm ci:quick` for Biome + full Vitest run.
4. Manual/integration (post-deploy, since this needs live Discord + Redis + accounts.gdgs.jp):
   confirm `/login` in a guild produces a linking URL, completing it sets both the personal link
   and the guild pointer, `/ask` from a second unlinked member in the same guild answers using the
   first member's link, and neither `@mention` nor a plain DM to the bot produces a response.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
