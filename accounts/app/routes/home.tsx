import { redirect } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import type { Route } from "./+types/home";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSessionUser(context.cloudflare.env, request);
  throw redirect(homeRedirect(session !== null));
}

export function homeRedirect(isAuthenticated: boolean): "/dashboard" | "/signin" {
  return isAuthenticated ? "/dashboard" : "/signin";
}

export default function Home() {
  return null;
}
