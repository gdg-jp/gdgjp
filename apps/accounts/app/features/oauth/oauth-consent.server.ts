import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { redirect } from "react-router";
import { runAuthHandler } from "~/features/auth/auth.server";
import { splitScopeParameter } from "~/features/oauth/scope-labels";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";

type PublicClient = {
  name: string;
  appUrl: string | null;
  ownerName: string | null;
  developerOwned: boolean;
};
type ClientRow = {
  name: string | null;
  uri: string | null;
  ownerName: string | null;
  developerOwned: number;
};

export async function loadOauthConsent({ request, context }: RouteRequestArgs) {
  const env = context.cloudflare.env;
  const t = await i18n.getFixedT(request);
  const query = new URL(request.url).searchParams;
  const valid = await verifyOAuthQueryParams(query.toString(), env.BETTER_AUTH_SECRET);
  const client = valid
    ? await env.DB.prepare(
        `SELECT c."name" AS name, c."uri" AS uri, owner."name" AS ownerName,
                c."userId" IS NOT NULL AS developerOwned
         FROM "oauthClient" c LEFT JOIN "user" owner ON owner."id" = c."userId"
         WHERE c."clientId" = ? AND COALESCE(c."disabled", 0) = 0 LIMIT 1`,
      )
        .bind(query.get("client_id"))
        .first<ClientRow>()
    : null;

  return {
    valid: client !== null,
    client: client ? toPublicClient(client) : null,
    scopes: client ? splitScopeParameter(query.get("scope")) : [],
    title: t("meta.oauthConsent"),
  };
}

export async function actOnOauthConsent({ request, context }: RouteRequestArgs) {
  const form = await request.formData();
  const oauthQuery = String(form.get("oauth_query") ?? "");
  const accept = form.get("accept") === "true";
  const url = new URL(request.url);
  url.pathname = "/api/auth/oauth2/consent";
  const headers = new Headers({
    cookie: request.headers.get("cookie") ?? "",
    "content-type": "application/json",
  });
  const origin = request.headers.get("origin");
  if (origin) headers.set("origin", origin);
  const referer = request.headers.get("referer");
  if (referer) headers.set("referer", referer);

  const response = await runAuthHandler(
    context.cloudflare.env,
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ accept, oauth_query: oauthQuery }),
    }),
  );
  if (!response.ok) return response;
  const data = (await response.json()) as { url?: string; redirect_uri?: string };
  const target = data.url ?? data.redirect_uri;
  if (!target) return new Response("Invalid consent response", { status: 500 });
  throw redirect(target);
}

function toPublicClient(client: ClientRow): PublicClient {
  return {
    name: client.name?.trim() || "",
    appUrl: safeHttpUrl(client.uri),
    ownerName: client.ownerName?.trim() || null,
    developerOwned: client.developerOwned === 1,
  };
}

export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
