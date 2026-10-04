import { redirect } from "react-router";
import { safeReturnTo } from "~/features/auth/auth-redirect";
import { i18n, localeCookie } from "~/lib/i18n/i18n.server";
import { isLocale } from "~/lib/i18n/resources";
import type { Route } from "./+types/api.locale";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const requested = form.get("locale");
  const next = isLocale(requested) ? requested : await i18n.getLocale(request);
  const returnToRaw = form.get("return_to");
  const returnTo =
    safeReturnTo(typeof returnToRaw === "string" ? returnToRaw : null) ?? "/dashboard";
  return redirect(returnTo, {
    headers: { "Set-Cookie": await localeCookie.serialize(next) },
  });
}

export function loader() {
  return redirect("/dashboard");
}
