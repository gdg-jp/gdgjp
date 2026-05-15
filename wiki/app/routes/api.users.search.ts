import { like, or } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

// GET /api/users/search?q=<query>
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireRole(request, env, "member");
  const db = getDb(env);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return Response.json({ users: [] });
  }

  const pattern = `%${q}%`;
  const users = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(or(like(schema.user.name, pattern), like(schema.user.email, pattern)))
    .limit(8);

  return Response.json({ users });
}
