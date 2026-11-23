import type { Route } from "./+types/dev.seed";

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (env.ENVIRONMENT === "production") throw new Response(null, { status: 404 });
  return Response.json({ ok: true, seeded: [] });
}

export default function DevSeed() {
  return null;
}
