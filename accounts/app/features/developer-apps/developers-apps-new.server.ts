import { data } from "react-router";
import { loadDeveloperAccess } from "~/features/developer-apps/developer-access.server";
import { parseDeveloperClientForm } from "~/features/developer-apps/developer-app-form.server";
import { createDeveloperClient } from "~/features/developer-apps/oauth-clients.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadDevelopersAppsNew(args: RouteRequestArgs) {
  const [t, access] = await Promise.all([
    i18n.getFixedT(args.request),
    loadDeveloperAccess(args.context.cloudflare.env, args.request),
  ]);
  return { ...access, title: t("meta.developerAppsNew") };
}

export async function actOnDevelopersAppsNew(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const [t, access] = await Promise.all([
    i18n.getFixedT(args.request),
    loadDeveloperAccess(env, args.request),
  ]);
  if (!access.eligible) throw new Response("Forbidden", { status: 403 });
  try {
    const result = await createDeveloperClient(
      env,
      args.request,
      parseDeveloperClientForm(await args.request.formData()),
    );
    return data(
      {
        ok: true as const,
        clientId: result.client.clientId,
        clientSecret: result.clientSecret,
      },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (error) {
    if (error instanceof Response && error.status === 403) throw error;
    return { ok: false as const, error: t("developerApps.errors.create") };
  }
}
