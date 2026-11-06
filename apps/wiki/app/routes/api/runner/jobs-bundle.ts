import type { LoaderFunctionArgs } from "react-router";
import { leaseAnswerBundle } from "~/features/jobs/answer.server";
import { requireRunner } from "~/features/jobs/runner-routes.server";
import { getDb } from "~/lib/db.server";

/** GET /api/runner/jobs/:id/bundle — an answer job's bundle and its asker-scoped job token. */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const bundle = await leaseAnswerBundle(env, getDb(env), params.id ?? "");
  return bundle ? Response.json(bundle) : Response.json({ error: "not_found" }, { status: 404 });
}
