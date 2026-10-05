import { data, redirect } from "react-router";
import { loadDeveloperAccess } from "~/features/developer-apps/developer-access.server";
import { parseDeveloperClientForm } from "~/features/developer-apps/developer-app-form.server";
import {
  deleteDeveloperClient,
  getDeveloperClient,
  rotateDeveloperClientSecret,
  setDeveloperClientEnabled,
  updateDeveloperClient,
} from "~/features/developer-apps/oauth-clients.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
type ClientLoaderArgs = Omit<RouteRequestArgs, "params"> & { params: { clientId: string } };
type ClientActionArgs = Omit<RouteRequestArgs, "params"> & { params: { clientId: string } };

export async function loadDevelopersAppsDetail(args: ClientLoaderArgs) {
  const env = args.context.cloudflare.env;
  const [t, locale, access] = await Promise.all([
    i18n.getFixedT(args.request),
    i18n.getLocale(args.request),
    loadDeveloperAccess(env, args.request),
  ]);
  const client = access.eligible
    ? await getDeveloperClient(env, args.request, args.params.clientId)
    : null;
  if (access.eligible && !client) throw new Response("Not Found", { status: 404 });
  return { ...access, client, locale, title: t("meta.developerAppsDetail") };
}

export async function actOnDevelopersAppsDetail(args: ClientActionArgs) {
  const env = args.context.cloudflare.env;
  const [t, access] = await Promise.all([
    i18n.getFixedT(args.request),
    loadDeveloperAccess(env, args.request),
  ]);
  if (!access.eligible) throw new Response("Forbidden", { status: 403 });
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "update") {
      await updateDeveloperClient(
        env,
        args.request,
        args.params.clientId,
        parseDeveloperClientForm(form),
      );
      return { ok: true as const, intent: "update" as const };
    }
    if (intent === "rotate") {
      const result = await rotateDeveloperClientSecret(env, args.request, args.params.clientId);
      return data(
        {
          ok: true as const,
          intent: "rotate" as const,
          clientId: result.client.clientId,
          clientSecret: result.clientSecret,
        },
        { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
      );
    }
    if (intent === "disable" || intent === "enable") {
      await setDeveloperClientEnabled(env, args.request, args.params.clientId, intent === "enable");
      return { ok: true as const, intent: intent as "disable" | "enable" };
    }
    if (intent === "delete") {
      await deleteDeveloperClient(env, args.request, args.params.clientId);
      return redirect("/developers/apps");
    }
    return { ok: false as const, error: t("errors.unknownAction") };
  } catch (error) {
    if (error instanceof Response && (error.status === 403 || error.status === 404)) throw error;
    return { ok: false as const, error: t("developerApps.errors.update") };
  }
}
