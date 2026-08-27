import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { data, redirect } from "react-router";
import { canAdministerContributors } from "~/features/contributors/contributor-policy";
import { contributorDepsFromEnv } from "~/features/contributors/contributor.deps.server";
import {
  addContributor,
  removeContributor,
} from "~/features/contributors/contributor.service.server";
import { requireSnsAccess } from "~/lib/access.server";
import { isValidEmail } from "~/lib/utils";
import type { Route } from "./+types/settings.contributors";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  if (
    !canAdministerContributors({
      role: access.chapter.role,
      isSuperAdmin: isSuperAdmin(access.user),
    })
  )
    throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!isValidEmail(email))
    return data({ error: "有効なメールアドレスを入力してください。" }, { status: 400 });
  const deps = contributorDepsFromEnv(context.cloudflare.env);
  if (form.get("intent") === "remove")
    await removeContributor(deps, access.chapter.chapterId, email);
  else await addContributor(deps, access.chapter.chapterId, email, access.user.id);
  throw redirect("/settings");
}
