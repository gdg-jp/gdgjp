import { listDraws } from "~/features/draw/draw.server";
import { drawLogCsv } from "~/features/draw/log";
import { requireProjectAccess } from "~/features/projects/access.server";
import type { Route } from "./+types/draws-csv";

/** Every spin of a project as CSV, for the organizers of its chapter. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { project } = await requireProjectAccess(env, request, params.slug);
  const entries = await listDraws(env.DB, project.slug);
  return new Response(drawLogCsv(entries), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${project.slug}-draws.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
