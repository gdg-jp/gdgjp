import type { Route } from "./+types/dev.seed";

/**
 * Local-dev / e2e seeding hook. Hard 404 in production, matching `/dev/login`.
 *
 * Stage 01 has no domain data to seed yet — `events` / `time_slots` / ... land
 * in Stage 02 (docs/roster/index.md §4). This route exists now so the
 * production-404 guard and the CI e2e wiring around it are in place before
 * there is anything to seed; a later stage replaces the body with a real
 * upsert (see `ost/app/routes/dev.seed.tsx` for the shape to follow).
 */
export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (env.ENVIRONMENT === "production") throw new Response(null, { status: 404 });
  return Response.json({ ok: true, seeded: [] });
}

export default function DevSeed() {
  return null;
}
