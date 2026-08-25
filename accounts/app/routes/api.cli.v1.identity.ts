import { getUserById, listActiveChaptersForUser } from "~/lib/db";
import { requireCliTokenUser } from "~/lib/oauth-clients.server";
import type { Route } from "./+types/api.cli.v1.identity";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const authorization = request.headers.get("authorization") ?? "";

  let id: string;
  try {
    ({ id } = await requireCliTokenUser(env, authorization));
  } catch {
    return unauthorized();
  }

  const user = await getUserById(env.DB, id);
  if (!user) return unauthorized();

  const chapters = await listActiveChaptersForUser(env.DB, id);

  return Response.json({ user, chapters }, { headers: { "Cache-Control": "no-store" } });
}

function unauthorized(): Response {
  return Response.json(
    { error: "invalid_token" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
