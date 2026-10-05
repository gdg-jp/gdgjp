import { loadDeveloperAccess } from "~/features/developer-apps/developer-access.server";
import { listDeveloperClients } from "~/features/developer-apps/oauth-clients.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadDevelopersApps(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const [t, locale] = await Promise.all([
    i18n.getFixedT(args.request),
    i18n.getLocale(args.request),
  ]);
  const access = await loadDeveloperAccess(env, args.request);
  const clients = access.eligible ? await listDeveloperClients(env, args.request) : [];
  return { ...access, clients, locale, title: t("meta.developerApps") };
}
