import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { DISCORD_IMPORTABLE_CHANNEL_TYPES, listGuildChannels } from "~/lib/discord-api.server";
import { getDiscordBotInviteUrl, hasRequiredDiscordOauthScopes } from "~/lib/discord-oauth.server";
import { getDiscordOauthTokenRow } from "~/lib/discord-token.server";

/**
 * List text/announcement channels in a guild via the bot token.
 * Requires the user to be Discord-connected and the bot to be in the guild.
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const guildId = params.guildId?.trim();
  if (!guildId || !/^\d+$/.test(guildId)) {
    return Response.json({ error: "invalid_guild" }, { status: 400 });
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_BOT_TOKEN) {
    return Response.json({ error: "discord_not_configured" }, { status: 503 });
  }

  const db = getDb(env);
  let token: Awaited<ReturnType<typeof getDiscordOauthTokenRow>>;
  try {
    token = await getDiscordOauthTokenRow(env, db, user.id);
  } catch {
    return Response.json({ error: "discord_not_connected" }, { status: 401 });
  }

  if (!hasRequiredDiscordOauthScopes(token.grantedScopes)) {
    return Response.json({ error: "discord_scopes_missing", reauthorize: true }, { status: 403 });
  }

  // Confirm the user belongs to this guild before exposing channel names.
  try {
    const { listUserGuilds } = await import("~/lib/discord-api.server");
    const userGuilds = await listUserGuilds(token.accessToken);
    if (!userGuilds.some((guild) => guild.id === guildId)) {
      return Response.json({ error: "forbidden_guild" }, { status: 403 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[discord] guild membership check failed", message);
    return Response.json({ error: "guilds_list_failed" }, { status: 502 });
  }

  try {
    const channels = await listGuildChannels(env.DISCORD_BOT_TOKEN, guildId);
    const textChannels = channels
      .filter((channel) => DISCORD_IMPORTABLE_CHANNEL_TYPES.has(channel.type))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parent_id ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    return Response.json({
      guildId,
      channels: textChannels,
    });
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "bot_missing") {
      return Response.json(
        {
          error: "bot_missing",
          inviteUrl: getDiscordBotInviteUrl(env.DISCORD_CLIENT_ID, guildId),
        },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[discord] channels.list failed", message);
    return Response.json({ error: "channels_list_failed" }, { status: 502 });
  }
}
