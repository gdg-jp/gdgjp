import { redirect } from "react-router";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { seedClients } from "~/features/oauth/seed-clients.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadAdminSeedClients({ request, context }: RouteRequestArgs) {
  const env = context.cloudflare.env;
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(env, request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) throw buildSignInRedirect(request);
    throw err;
  }
  if (!user.isAdmin) throw new Response("Forbidden", { status: 403 });
  return { user };
}

export async function actOnAdminSeedClients({ request, context }: RouteRequestArgs) {
  const env = context.cloudflare.env;
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(env, request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) throw buildSignInRedirect(request);
    throw err;
  }
  if (!user.isAdmin) throw new Response("Forbidden", { status: 403 });
  if (request.method !== "POST") throw redirect("/admin/seed-clients");
  const result = await seedClients(env);
  return { ...result, at: new Date().toISOString() };
}
