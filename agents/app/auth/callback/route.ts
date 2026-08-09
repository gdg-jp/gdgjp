import { handleAuthCallback, linkAccountDepsFromEnv } from "../../../lib/link-account";

export const runtime = "nodejs";

/**
 * OAuth callback for Chat → GDG Accounts linking.
 *
 * Identity binding comes only from the single-use Redis state record.
 * Do not log the request URL — it contains `code` and `state`.
 */
export async function GET(request: Request): Promise<Response> {
  return handleAuthCallback(request, linkAccountDepsFromEnv());
}
