import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { decryptRefreshToken } from "~/features/google-workspace/encryption.server";
import {
  getWorkspaceConnection,
  revokeGoogleToken,
  revokeWorkspaceConnection,
} from "~/features/google-workspace/google-workspace.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadSettingsGoogleWorkspace(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const [t, user] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).catch((err: unknown) => {
      if (err instanceof Response && err.status === 401) throw buildSignInRedirect(args.request);
      throw err;
    }),
  ]);
  const connection = await getWorkspaceConnection(env.DB, user.id);
  const url = new URL(args.request.url);
  return {
    title: t("meta.googleWorkspace"),
    connected: connection !== null && connection.revokedAt === null,
    scope: connection?.revokedAt === null ? connection.scope : null,
    connectedAt: connection?.revokedAt === null ? connection.connectedAt : null,
    workspaceStatus: url.searchParams.get("workspace"),
    workspaceReason: url.searchParams.get("workspace_reason"),
  };
}

export async function actOnSettingsGoogleWorkspace(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const user = await requireUser(env, args.request).catch((err: unknown) => {
    if (err instanceof Response && err.status === 401) throw buildSignInRedirect(args.request);
    throw err;
  });
  const form = await args.request.formData();
  if (String(form.get("intent") ?? "") !== "disconnect") {
    return { ok: false as const };
  }

  const connection = await getWorkspaceConnection(env.DB, user.id);
  if (connection && connection.revokedAt === null) {
    // Local disconnect must succeed even if the token can't be decrypted
    // (stale/missing key, corrupted row) or Google's revoke call fails —
    // otherwise the user would be unable to disconnect, and vending would
    // resume if the key later became available again.
    try {
      const refreshToken = await decryptRefreshToken(
        env,
        user.id,
        connection.encryptionKeyVersion,
        connection.refreshTokenCiphertext,
        connection.refreshTokenNonce,
      );
      await revokeGoogleToken(env, refreshToken);
    } catch (error) {
      console.error("Google Workspace disconnect: failed to revoke the token with Google", error);
    } finally {
      await revokeWorkspaceConnection(env.DB, user.id);
    }
  }
  return { ok: true as const };
}
