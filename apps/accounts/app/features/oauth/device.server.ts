import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser, runAuthHandler } from "~/features/auth/auth.server";
import {
  approveDeviceCode,
  denyDeviceCode,
  findPendingDeviceCodeByUserCode,
} from "~/features/oauth/device-authorization.server";
import type { ActionResult } from "~/features/oauth/device-shared";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";

export async function loadDevice({ request, context }: RouteRequestArgs) {
  const env = context.cloudflare.env;
  let user: AuthUser;
  try {
    user = await requireUser(env, request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) throw buildSignInRedirect(request);
    throw error;
  }

  const t = await i18n.getFixedT(request);
  const userCode = new URL(request.url).searchParams.get("user_code") ?? "";
  const pending = userCode ? await findPendingDeviceCodeByUserCode(env, userCode) : null;
  return { user, userCode, pending, title: t("meta.device") };
}

export async function actOnDevice({ request, context }: RouteRequestArgs) {
  const env = context.cloudflare.env;
  let user: AuthUser;
  try {
    user = await requireUser(env, request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) throw buildSignInRedirect(request);
    throw error;
  }

  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");
  if (!id) return { status: "failed" } satisfies ActionResult;

  if (intent === "deny") {
    await denyDeviceCode(env, id);
    return { status: "denied" } satisfies ActionResult;
  }
  const approved = await approveDeviceCode(env, request, id, user.id, runAuthHandler);
  return { status: approved ? "approved" : "failed" } satisfies ActionResult;
}
