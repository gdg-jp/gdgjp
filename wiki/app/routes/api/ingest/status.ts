import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const session = await db
    .select({
      status: schema.ingestionSessions.status,
      errorMessage: schema.ingestionSessions.errorMessage,
      phaseMessage: schema.ingestionSessions.phaseMessage,
      userId: schema.ingestionSessions.userId,
      updatedAt: schema.ingestionSessions.updatedAt,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""))
    .get();

  if (!session) throw new Response("Not found", { status: 404 });
  if (session.userId !== user.id) throw new Response("Forbidden", { status: 403 });

  const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;
  if (session.status === "processing" && session.updatedAt) {
    const ageMs = Date.now() - session.updatedAt.getTime();
    if (ageMs > PROCESSING_TIMEOUT_MS) {
      const timeoutError = "Ingestion timed out. Please start a new session.";
      await db
        .update(schema.ingestionSessions)
        .set({
          status: "error",
          errorMessage: timeoutError,
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""));
      return Response.json({ status: "error", errorMessage: timeoutError, phaseMessage: null });
    }
  }

  return Response.json({
    status: session.status,
    errorMessage: session.errorMessage,
    phaseMessage: session.phaseMessage,
  });
}
