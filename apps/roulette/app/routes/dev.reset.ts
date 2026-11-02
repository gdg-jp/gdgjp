import { resetDraws } from "~/features/projects/projects.server";
import { normalizeSlug } from "~/features/projects/slug";
import type { Route } from "./+types/dev.reset";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Local-dev shortcut for trying the spin effects again: clears the project's
 * spins and returns to its spin page, keeping `?demo=`. 404 unless the app runs
 * on a loopback URL, like `/dev/login`.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const slug = normalizeSlug(params.slug);
  if (!LOOPBACK.has(new URL(env.APP_URL).hostname) || !slug)
    throw new Response(null, { status: 404 });
  await resetDraws(env.DB, slug);
  const demo = new URL(request.url).searchParams.get("demo");
  const query = demo ? `?${new URLSearchParams({ demo })}` : "";
  return Response.redirect(new URL(`/${slug}${query}`, request.url), 302);
}
