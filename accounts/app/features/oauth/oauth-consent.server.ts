import { redirect } from "react-router";
import { runAuthHandler } from "~/features/auth/auth.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
type PublicClient = { name: string; appUrl: string | null };

export async function loadOauthConsent({ request, context }: RouteRequestArgs) {
  const [t] = await Promise.all([i18n.getFixedT(request)]);
  const clientId = new URL(request.url).searchParams.get("client_id");
  const client = clientId
    ? await context.cloudflare.env.DB.prepare(
        "SELECT name, uri FROM oauthClient WHERE clientId = ? AND COALESCE(disabled, 0) = 0 LIMIT 1",
      )
        .bind(clientId)
        .first<{ name: string | null; uri: string | null }>()
    : null;

  return {
    client: client ? toPublicClient(client) : null,
    title: t("meta.oauthConsent"),
  };
}

export async function actOnOauthConsent({ request, context }: RouteRequestArgs) {
  const form = await request.formData();
  const oauthQuery = String(form.get("oauth_query") ?? "");
  const accept = form.get("accept") === "true";
  const url = new URL(request.url);
  url.pathname = "/api/auth/oauth2/consent";
  const response = await runAuthHandler(
    context.cloudflare.env,
    new Request(url, {
      method: "POST",
      headers: { cookie: request.headers.get("cookie") ?? "", "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: oauthQuery }),
    }),
  );
  if (!response.ok) return response;
  const data = (await response.json()) as { redirect_uri?: string };
  if (!data.redirect_uri) return new Response("Invalid consent response", { status: 500 });
  throw redirect(data.redirect_uri);
}

function toPublicClient(client: { name: string | null; uri: string | null }): PublicClient {
  return {
    name: client.name?.trim() || "",
    appUrl: safeHttpUrl(client.uri),
  };
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
