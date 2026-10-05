import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/features/auth/utils.server";
import { getDiscordAuthUrl } from "~/features/discord/oauth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireUser(request, env);

  if (!env.DISCORD_CLIENT_ID) {
    throw redirect("/sources?error=discord_not_configured");
  }

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/sources";

  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const nonce = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const state = `${nonce}:${returnTo}`;

  const redirectUri = `${url.origin}/api/discord/callback`;
  const authUrl = getDiscordAuthUrl(env.DISCORD_CLIENT_ID, redirectUri, state);

  throw redirect(authUrl, {
    headers: {
      "Set-Cookie": `discord_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    },
  });
}
