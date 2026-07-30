import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getGoogleDriveAccessToken } from "~/lib/google-drive-token.server";

/** Supplies the authenticated browser with the short-lived token Google Picker requires. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);

  try {
    const accessToken = await getGoogleDriveAccessToken(env, getDb(env), user.id);
    const oauthProjectNumber = env.GOOGLE_DOCS_CLIENT_ID.match(
      /^(\d+)-.+\.apps\.googleusercontent\.com$/,
    )?.[1];
    const configuredProjectNumber = env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim();
    const appId = configuredProjectNumber || oauthProjectNumber;
    if (!env.GOOGLE_PICKER_API_KEY?.trim() || !appId || !/^\d+$/.test(appId)) {
      return Response.json({ error: "picker_not_configured" }, { status: 503 });
    }
    if (
      oauthProjectNumber &&
      configuredProjectNumber &&
      configuredProjectNumber !== oauthProjectNumber
    ) {
      return Response.json({ error: "picker_project_mismatch" }, { status: 503 });
    }
    return Response.json({
      accessToken,
      apiKey: env.GOOGLE_PICKER_API_KEY,
      appId,
    });
  } catch {
    return Response.json({ error: "drive_not_connected" }, { status: 401 });
  }
}
