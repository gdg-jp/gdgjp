import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");
  const db = drizzle(env.DB, { schema });

  const session = await db
    .select({
      userId: schema.ingestionSessions.userId,
      status: schema.ingestionSessions.status,
      errorMessage: schema.ingestionSessions.errorMessage,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""))
    .get();

  if (!session) return new Response("Not found", { status: 404 });
  if (session.userId !== user.id) return new Response("Forbidden", { status: 403 });

  return Response.json({ status: session.status, errorMessage: session.errorMessage });
}
