import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { listGoogleChatSpaces } from "~/lib/google-chat.server";
import { getGoogleDriveTokenRow } from "~/lib/google-drive-token.server";
import { hasRequiredGoogleChatScopes } from "~/lib/google-drive.server";

/**
 * List Google Chat Spaces the signed-in user participates in.
 * Requires Chat OAuth scopes recorded on google_drive_tokens.granted_scopes.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  let token: Awaited<ReturnType<typeof getGoogleDriveTokenRow>>;
  try {
    token = await getGoogleDriveTokenRow(env, db, user.id);
  } catch {
    return Response.json({ error: "drive_not_connected" }, { status: 401 });
  }

  if (!hasRequiredGoogleChatScopes(token.grantedScopes)) {
    return Response.json({ error: "chat_scopes_missing", reauthorize: true }, { status: 403 });
  }

  try {
    const spaces = await listGoogleChatSpaces(token.accessToken);
    return Response.json({
      spaces: spaces.map((space) => ({
        name: space.name,
        displayName: space.displayName ?? space.name,
        spaceType: space.spaceType ?? null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[google-chat] spaces.list failed", message);
    return Response.json({ error: "spaces_list_failed" }, { status: 502 });
  }
}
