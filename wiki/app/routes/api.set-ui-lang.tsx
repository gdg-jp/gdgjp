import { eq } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { type SupportedLng, supportedLngs } from "~/i18n";
import { getSessionUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const formData = await request.formData();
  const lang = formData.get("lang");

  if (typeof lang !== "string" || !(supportedLngs as readonly string[]).includes(lang)) {
    return Response.json({ ok: false, error: "invalid lang" }, { status: 400 });
  }

  const user = await getSessionUser(request, env);
  if (user) {
    const db = getDb(env);
    await db
      .update(schema.user)
      .set({ preferredUiLanguage: lang as SupportedLng })
      .where(eq(schema.user.id, user.id));
  }

  // Set a cookie so subsequent SSR requests render in the chosen language.
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `ui_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`,
      },
    },
  );
}
