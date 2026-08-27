import { redirect } from "react-router";
import { xAccountDepsFromEnv } from "~/features/x-accounts/x-account.deps.server";
import { XAccountError, revokeXAccount } from "~/features/x-accounts/x-account.service.server";
import { requireSnsAccess } from "~/lib/access.server";
import type { Route } from "./+types/settings.x";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const xUserId = String(form.get("xUserId") ?? "");
  if (form.get("intent") !== "revoke" || !id || !xUserId)
    throw new Response("Bad request", { status: 400 });
  try {
    await revokeXAccount(
      xAccountDepsFromEnv(context.cloudflare.env),
      id,
      access.chapter.chapterId,
      xUserId,
    );
  } catch (error) {
    if (error instanceof XAccountError) throw new Response(error.message, { status: 400 });
    throw error;
  }
  throw redirect("/settings");
}
