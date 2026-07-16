import { redirect } from "react-router";
import { safeReturnTo } from "~/lib/auth-redirect";
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/auth.signout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to")) ?? "/signin";
  const response = await getAuth(context.cloudflare.env).api.signOut({
    headers: request.headers,
    asResponse: true,
  });
  const headers = new Headers({ Location: returnTo });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  throw redirect(returnTo, { headers });
}
