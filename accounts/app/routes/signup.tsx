import { i18n } from "~/lib/i18n/i18n.server";
import type { Route } from "./+types/signup";
export { default, meta } from "~/routes/auth/signin";

export async function loader({ request }: Route.LoaderArgs) {
  const t = await i18n.getFixedT(request);
  return { title: t("meta.signup") };
}
