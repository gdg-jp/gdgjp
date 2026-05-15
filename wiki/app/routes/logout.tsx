import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { createAuth } from "~/lib/auth.server";

/**
 * POST /logout — signs the user out via better-auth, clears the session cookie,
 * then redirects to /login.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const auth = createAuth(context.cloudflare.env);

  // Forward to better-auth's sign-out handler to get the proper Set-Cookie header
  const url = new URL(request.url);
  const signOutRequest = new Request(`${url.origin}/api/auth/sign-out`, {
    method: "POST",
    headers: request.headers,
  });
  const response = await auth.handler(signOutRequest);

  const headers = new Headers(response.headers);
  headers.set("Location", "/login");
  return new Response(null, { status: 302, headers });
}

// GET /logout redirects to home (only POST is a valid sign-out)
export async function loader() {
  throw redirect("/");
}
