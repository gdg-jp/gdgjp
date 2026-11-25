import { safeReturnTo } from "@gdgjp/gdg-lib/auth/return-to";
import { redirect } from "react-router";
import { authUnavailableResponse, getAuth, withAuthTimeout } from "~/features/auth/auth.server";
import type { Route } from "./+types/auth.signout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"), url.origin) ?? "/signin";
  const response = await withAuthTimeout(
    getAuth(context.cloudflare.env).api.signOut({
      headers: request.headers,
      asResponse: true,
    }),
    authUnavailableResponse,
  );
  if (!response.ok) return response;
  const headers = new Headers({ Location: returnTo });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  throw redirect(returnTo, { headers });
}
