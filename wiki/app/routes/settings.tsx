import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useLoaderData } from "react-router";
import { PushNotificationToggle } from "~/components/PushNotificationToggle";
import * as schema from "~/db/schema";
import { supportedLngs } from "~/i18n";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import type { Route } from ".react-router/types/app/routes/+types/settings";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { cloudflare } = context;
  const user = await requireUser(request, cloudflare.env);
  const db = getDb(cloudflare.env);
  const prefs = await db
    .select({
      preferredUiLanguage: schema.userPreferences.preferredUiLanguage,
      preferredContentLanguage: schema.userPreferences.preferredContentLanguage,
      discordId: schema.userPreferences.discordId,
    })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, user.id))
    .get();
  return {
    user,
    preferredUiLanguage: prefs?.preferredUiLanguage ?? "ja",
    preferredContentLanguage: prefs?.preferredContentLanguage ?? "ja",
    discordId: prefs?.discordId ?? null,
  };
}

type ActionErrors = { name?: string; lang?: string; discordId?: string };
type ActionResult = { ok: boolean; errors?: ActionErrors; uiLang?: string };

export async function action({ request, context }: Route.ActionArgs): Promise<ActionResult> {
  const { cloudflare } = context;
  const user = await requireUser(request, cloudflare.env);
  const db = getDb(cloudflare.env);
  const form = await request.formData();

  const name = (form.get("name") as string | null)?.trim() ?? "";
  const uiLang = form.get("uiLang") as string | null;
  const contentLang = form.get("contentLang") as string | null;
  const discordId = (form.get("discordId") as string | null)?.trim() ?? "";

  const errors: ActionErrors = {};

  if (!name || name.length > 100) errors.name = "invalid_name";
  if (!uiLang || !supportedLngs.includes(uiLang as never)) errors.lang = "invalid_lang";
  if (!contentLang || !supportedLngs.includes(contentLang as never)) errors.lang = "invalid_lang";
  if (discordId && !/^\d{17,20}$/.test(discordId)) errors.discordId = "invalid_discord_id";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  try {
    await db
      .update(schema.user)
      .set({ name, updatedAt: new Date() })
      .where(eq(schema.user.id, user.id));

    await db
      .insert(schema.userPreferences)
      .values({
        userId: user.id,
        preferredUiLanguage: uiLang as string,
        preferredContentLanguage: contentLang as string,
        discordId: discordId || null,
      })
      .onConflictDoUpdate({
        target: schema.userPreferences.userId,
        set: {
          preferredUiLanguage: uiLang as string,
          preferredContentLanguage: contentLang as string,
          discordId: discordId || null,
        },
      });
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return { ok: false, errors: { discordId: "discord_id_taken" } };
    }
    throw err;
  }

  return { ok: true, uiLang: uiLang as string };
}

// ---------------------------------------------------------------------------
// SaveButton: Save → Saving... → Saved (auto-clears after 3s)
// ---------------------------------------------------------------------------
function SaveButton({
  state,
  saved,
}: {
  state: "idle" | "submitting" | "loading";
  saved: boolean;
}) {
  const { t } = useTranslation();
  const submitting = state !== "idle";

  let label = t("settings.save");
  if (submitting) label = t("settings.saving");
  else if (saved) label = t("settings.saved");

  return (
    <button
      type="submit"
      disabled={submitting}
      className="shrink-0 rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SettingsSection
// ---------------------------------------------------------------------------
function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-6 py-6">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-sm text-gray-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings page component
// ---------------------------------------------------------------------------
export default function SettingsPage() {
  const { user, preferredUiLanguage, preferredContentLanguage, discordId } =
    useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();

  const fetcher = useFetcher<typeof action>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok === true) {
      if (fetcher.data.uiLang) {
        i18n.changeLanguage(fetcher.data.uiLang);
        localStorage.setItem("ui_lang", fetcher.data.uiLang);
      }
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data, i18n]);

  const errors = fetcher.data?.ok === false ? fetcher.data.errors : undefined;

  return (
    <div className="px-8 py-8">
      <fetcher.Form method="post">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-gray-900">{t("settings.title")}</h1>
            <p className="text-sm text-gray-500">{t("settings.subtitle")}</p>
          </div>
          <SaveButton state={fetcher.state} saved={saved} />
        </div>

        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {/* Display Name */}
          <SettingsSection
            title={t("settings.name.title")}
            description={t("settings.name.description")}
          >
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              {t("settings.name.label")}
            </label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={user.name}
              maxLength={100}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors?.name && (
              <p className="mt-1 text-xs text-red-500">
                {t(`settings.errors.${errors.name}`, t("settings.save_error"))}
              </p>
            )}
          </SettingsSection>

          {/* Language Preferences */}
          <SettingsSection
            title={t("settings.language.title")}
            description={t("settings.language.description")}
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="uiLang" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("settings.language.ui_label")}
                </label>
                <select
                  id="uiLang"
                  name="uiLang"
                  defaultValue={preferredUiLanguage}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {supportedLngs.map((lng) => (
                    <option key={lng} value={lng}>
                      {t(`language.${lng}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="contentLang"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  {t("settings.language.content_label")}
                </label>
                <select
                  id="contentLang"
                  name="contentLang"
                  defaultValue={preferredContentLanguage}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {supportedLngs.map((lng) => (
                    <option key={lng} value={lng}>
                      {t(`language.${lng}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {errors?.lang && (
              <p className="mt-2 text-xs text-red-500">
                {t(`settings.errors.${errors.lang}`, t("settings.save_error"))}
              </p>
            )}
          </SettingsSection>

          {/* Push Notifications */}
          <SettingsSection
            title={t("settings.push.title")}
            description={t("settings.push.description")}
          >
            <PushNotificationToggle />
          </SettingsSection>

          {/* Discord */}
          <SettingsSection
            title={t("settings.discord.title")}
            description={t("settings.discord.description")}
          >
            <label htmlFor="discordId" className="mb-1 block text-sm font-medium text-gray-700">
              {t("settings.discord.idLabel")}
            </label>
            <input
              id="discordId"
              name="discordId"
              type="text"
              defaultValue={discordId ?? ""}
              placeholder="e.g. 123456789012345678"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">{t("settings.discord.idHint")}</p>
            {errors?.discordId && (
              <p className="mt-1 text-xs text-red-500">
                {t(`settings.errors.${errors.discordId}`, t("settings.save_error"))}
              </p>
            )}
          </SettingsSection>
        </div>
      </fetcher.Form>
    </div>
  );
}
