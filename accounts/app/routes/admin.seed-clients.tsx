// One-shot admin route to (re-)seed the trusted OAuth clients into OAUTH_KV.
// Idempotent — safe to re-run after rotating a client secret.

import { redirect, useActionData, useNavigation } from "react-router";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import { seedClients } from "~/lib/seed-clients.server";
import type { Route } from "./+types/admin.seed-clients";

export async function loader({ request, context }: Route.LoaderArgs) {
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

export async function action({ request, context }: Route.ActionArgs) {
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

export default function SeedClientsPage() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== "idle";
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-medium">Seed OAuth clients</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Writes the four trusted OAuth client records (tinyurl, wiki, img, scheduler) into{" "}
        <code>OAUTH_KV</code> from the configured env vars. Idempotent — safe to re-run.
      </p>
      <form method="post" className="mt-6">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {submitting ? "Seeding…" : "(Re)seed clients"}
        </button>
      </form>
      {actionData ? (
        <div className="mt-6 space-y-2 text-sm">
          <p className="font-medium">Result at {actionData.at}</p>
          <p>Written: {actionData.written.join(", ") || "(none)"}</p>
          <p>Skipped (missing secret/urls): {actionData.skipped.join(", ") || "(none)"}</p>
        </div>
      ) : null}
    </main>
  );
}
