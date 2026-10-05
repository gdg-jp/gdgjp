import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/features/auth/utils.server";
import { listBotGuilds, listUserGuilds } from "~/features/discord/api.server";
import {
  getDiscordBotInviteUrl,
  hasRequiredDiscordOauthScopes,
} from "~/features/discord/oauth.server";
import { getDiscordOauthTokenRow } from "~/features/discord/token.server";
import { getDb } from "~/lib/db.server";

/**
 * List Discord guilds the signed-in user belongs to, annotated with whether the
 * wiki bot is installed (required before channel listing / history import).
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_BOT_TOKEN) {
    return Response.json({ error: "discord_not_configured" }, { status: 503 });
  }

  let token: Awaited<ReturnType<typeof getDiscordOauthTokenRow>>;
  try {
    token = await getDiscordOauthTokenRow(env, db, user.id);
  } catch {
    return Response.json({ error: "discord_not_connected" }, { status: 401 });
  }

  if (!hasRequiredDiscordOauthScopes(token.grantedScopes)) {
    return Response.json({ error: "discord_scopes_missing", reauthorize: true }, { status: 403 });
  }

  try {
    const [userGuilds, botGuilds] = await Promise.all([
      listUserGuilds(token.accessToken),
      listBotGuilds(env.DISCORD_BOT_TOKEN),
    ]);
    const botGuildIds = new Set(botGuilds.map((guild) => guild.id));
    const guilds = userGuilds
      .map((guild) => {
        const botInstalled = botGuildIds.has(guild.id);
        return {
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
          botInstalled,
          inviteUrl: botInstalled ? null : getDiscordBotInviteUrl(env.DISCORD_CLIENT_ID, guild.id),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    return Response.json({
      botInviteUrl: getDiscordBotInviteUrl(env.DISCORD_CLIENT_ID),
      guilds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[discord] guilds.list failed", message);
    return Response.json({ error: "guilds_list_failed" }, { status: 502 });
  }
}
