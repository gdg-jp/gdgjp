import { and, eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const tokens = await db
    .select({ token: schema.fcmTokens.token })
    .from(schema.fcmTokens)
    .where(eq(schema.fcmTokens.userId, user.id))
    .all();

  return Response.json({ enabled: tokens.length > 0, deviceCount: tokens.length });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const body = await request.json<{ intent: string; token?: string; deviceLabel?: string }>();
  const { intent } = body;

  if (intent === "register") {
    const { token, deviceLabel } = body;
    if (typeof token !== "string" || !token) {
      return Response.json({ error: "Missing token" }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(schema.fcmTokens)
      .values({
        token,
        userId: user.id,
        deviceLabel: deviceLabel ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.fcmTokens.token,
        set: { userId: user.id, deviceLabel: deviceLabel ?? null, updatedAt: now },
      });

    return Response.json({ ok: true });
  }

  if (intent === "unregister") {
    const { token } = body;
    if (typeof token !== "string" || !token) {
      return Response.json({ error: "Missing token" }, { status: 400 });
    }

    await db
      .delete(schema.fcmTokens)
      .where(and(eq(schema.fcmTokens.token, token), eq(schema.fcmTokens.userId, user.id)));

    return Response.json({ ok: true });
  }

  if (intent === "unregister-all") {
    await db.delete(schema.fcmTokens).where(eq(schema.fcmTokens.userId, user.id));
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}
