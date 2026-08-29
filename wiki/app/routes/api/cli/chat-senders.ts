import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getDb } from "~/lib/db.server";

/** GET /api/cli/wiki/chat-senders — resourceName → displayName map for gdg wiki raw. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const db = getDb(env);
  const rows = await db
    .select({
      resourceName: schema.googleChatSenderProfiles.resourceName,
      displayName: schema.googleChatSenderProfiles.displayName,
    })
    .from(schema.googleChatSenderProfiles)
    .all();

  return Response.json({
    senders: rows.map((row) => ({
      resourceName: row.resourceName,
      displayName: row.displayName,
    })),
  });
}
