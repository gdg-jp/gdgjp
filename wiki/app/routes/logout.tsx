import type { LoaderFunctionArgs } from "react-router";

/**
 * GET /logout — federated sign-out.
 * Redirects to the accounts IdP's /auth/signout, which clears each
 * registered RP's session cookie via hidden iframes and then returns
 * the user to /login.
 */
export function loader({ context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;
  const returnTo = `${env.APP_URL}/login`;
  const location = `${env.IDP_URL}/auth/signout?return_to=${encodeURIComponent(returnTo)}`;
  return new Response(null, { status: 302, headers: { Location: location } });
}
