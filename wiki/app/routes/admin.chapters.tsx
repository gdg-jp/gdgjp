import { and, count, eq, ne } from "drizzle-orm";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { sendInvitationEmail } from "~/lib/email.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireRole(request, env, "admin");
  const db = getDb(env);

  const chapters = await db
    .select({
      id: schema.chapters.id,
      nameJa: schema.chapters.nameJa,
      nameEn: schema.chapters.nameEn,
      abbreviation: schema.chapters.abbreviation,
      university: schema.chapters.university,
      region: schema.chapters.region,
      createdAt: schema.chapters.createdAt,
    })
    .from(schema.chapters)
    .all();

  // Member counts per chapter
  const memberCounts = await db
    .select({ chapterId: schema.user.chapterId, count: count() })
    .from(schema.user)
    .groupBy(schema.user.chapterId)
    .all();

  const countMap = Object.fromEntries(
    memberCounts
      .filter((r): r is typeof r & { chapterId: string } => r.chapterId !== null)
      .map((r) => [r.chapterId, r.count]),
  );

  const discordSettings = await db.select().from(schema.discordGuildSettings).all();
  const discordSettingsMap = Object.fromEntries(discordSettings.map((s) => [s.chapterId, s]));

  return { chapters, countMap, discordSettingsMap };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const currentUser = await requireRole(request, env, "admin");
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const db = getDb(env);

  if (intent === "createChapter") {
    const nameJa = (form.get("nameJa") as string).trim();
    const nameEn = (form.get("nameEn") as string).trim();
    const abbreviation = (form.get("abbreviation") as string).trim();
    const university = (form.get("university") as string).trim();
    const region = (form.get("region") as string).trim();
    const leadEmail = (form.get("leadEmail") as string).trim().toLowerCase();

    if (!nameJa || !nameEn || !abbreviation || !university || !region || !leadEmail) {
      return { error: "All fields are required." };
    }
    if (!leadEmail.includes("@")) {
      return { error: "Invalid lead email address." };
    }

    const chapterId = crypto.randomUUID();
    await db.insert(schema.chapters).values({
      id: chapterId,
      nameJa,
      nameEn,
      abbreviation,
      university,
      region,
    });

    // Create lead invitation
    const token = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    await db.insert(schema.invitations).values({
      id: crypto.randomUUID(),
      email: leadEmail,
      chapterId,
      role: "lead",
      invitedBy: currentUser.id,
      token,
      expiresAt,
    });

    await sendInvitationEmail(env, {
      to: leadEmail,
      role: "lead",
      chapterName: nameEn,
      siteUrl: env.BETTER_AUTH_URL,
    });

    return { ok: true, invitedEmail: leadEmail };
  }

  if (intent === "deleteChapter") {
    const chapterId = form.get("chapterId") as string;
    if (chapterId) {
      await db.delete(schema.chapters).where(eq(schema.chapters.id, chapterId));
    }
    return { ok: true };
  }

  if (intent === "updateDiscordSettings") {
    const chapterId = (form.get("chapterId") as string).trim();
    const guildId = (form.get("guildId") as string).trim();
    const reminderChannelId = (form.get("reminderChannelId") as string).trim();
    const enabled = form.get("enabled") === "1" ? 1 : 0;
    if (!chapterId || !guildId || !reminderChannelId) {
      return { error: "Guild ID and channel ID are required." };
    }
    const now = new Date();
    // Reject if this guildId is already owned by a different chapter
    const conflict = await db
      .select()
      .from(schema.discordGuildSettings)
      .where(
        and(
          eq(schema.discordGuildSettings.guildId, guildId),
          ne(schema.discordGuildSettings.chapterId, chapterId),
        ),
      )
      .get();
    if (conflict) {
      return { error: "This Discord server is already linked to another chapter." };
    }
    // Remove stale binding for this chapter under a different guild
    await db
      .delete(schema.discordGuildSettings)
      .where(
        and(
          eq(schema.discordGuildSettings.chapterId, chapterId),
          ne(schema.discordGuildSettings.guildId, guildId),
        ),
      );
    await db
      .insert(schema.discordGuildSettings)
      .values({ guildId, chapterId, reminderChannelId, enabled, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.discordGuildSettings.guildId,
        set: { chapterId, reminderChannelId, enabled, updatedAt: now },
      });
    return { ok: true };
  }

  return {};
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export default function AdminChapters() {
  const { chapters, countMap, discordSettingsMap } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t("admin.chapters.heading")}</h1>

      {/* Flash messages */}
      {"ok" in (actionData ?? {}) && actionData?.ok && "invitedEmail" in (actionData ?? {}) && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {t("admin.chapters.invite_sent", {
            email: (actionData as { invitedEmail: string }).invitedEmail,
          })}
        </div>
      )}
      {"error" in (actionData ?? {}) && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {(actionData as { error: string }).error}
        </div>
      )}

      {/* Chapters table */}
      <div className="mb-10 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.chapters.col_name")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.chapters.col_abbreviation")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.chapters.col_university")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.chapters.col_region")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("admin.chapters.col_members")}
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {chapters.map((ch) => (
              <Fragment key={ch.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{ch.nameEn}</div>
                    <div className="text-xs text-gray-400">{ch.nameJa}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{ch.abbreviation}</td>
                  <td className="px-4 py-3 text-gray-600">{ch.university}</td>
                  <td className="px-4 py-3 text-gray-600">{ch.region}</td>
                  <td className="px-4 py-3 text-gray-500">{countMap[ch.id] ?? 0}</td>
                  <td className="px-4 py-3">
                    <Form method="post">
                      <input type="hidden" name="intent" value="deleteChapter" />
                      <input type="hidden" name="chapterId" value={ch.id} />
                      <button
                        type="submit"
                        onClick={(e) => {
                          if (!confirm(`Delete "${ch.nameEn}"? This cannot be undone.`)) {
                            e.preventDefault();
                          }
                        }}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        {t("admin.pages.delete")}
                      </button>
                    </Form>
                  </td>
                </tr>
                <tr
                  key={`${ch.id}-discord`}
                  className="border-t border-dashed border-gray-100 bg-gray-50"
                >
                  <td colSpan={6} className="px-4 py-3">
                    <Form method="post" className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="intent" value="updateDiscordSettings" />
                      <input type="hidden" name="chapterId" value={ch.id} />
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">
                          {t("admin.chapters.discord.guild_id")}
                        </span>
                        <input
                          name="guildId"
                          defaultValue={discordSettingsMap[ch.id]?.guildId ?? ""}
                          placeholder="000000000000000000"
                          className="w-48 rounded border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-500">
                          {t("admin.chapters.discord.channel_id")}
                        </span>
                        <input
                          name="reminderChannelId"
                          defaultValue={discordSettingsMap[ch.id]?.reminderChannelId ?? ""}
                          placeholder="000000000000000000"
                          className="w-48 rounded border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </label>
                      <label className="flex items-center gap-2 pb-1.5 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          name="enabled"
                          value="1"
                          defaultChecked={(discordSettingsMap[ch.id]?.enabled ?? 1) === 1}
                          className="rounded border-gray-300"
                        />
                        {t("admin.chapters.discord.enabled")}
                      </label>
                      <div className="pb-1.5">
                        <button
                          type="submit"
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                        >
                          {t("admin.chapters.discord.save")}
                        </button>
                      </div>
                    </Form>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        {chapters.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-gray-400">{t("admin.chapters.empty")}</p>
        )}
      </div>

      {/* New chapter form */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          {t("admin.chapters.new_chapter")}
        </h2>
        <Form method="post" className="grid grid-cols-2 gap-4">
          <input type="hidden" name="intent" value="createChapter" />

          <div className="col-span-2 grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">
                {t("admin.chapters.form.name_ja")}
              </span>
              <input
                name="nameJa"
                required
                className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">
                {t("admin.chapters.form.name_en")}
              </span>
              <input
                name="nameEn"
                required
                className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">
              {t("admin.chapters.form.abbreviation")}
            </span>
            <input
              name="abbreviation"
              required
              placeholder="e.g. GDGoC Osaka"
              className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">
              {t("admin.chapters.form.university")}
            </span>
            <input
              name="university"
              required
              className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">
              {t("admin.chapters.form.region")}
            </span>
            <input
              name="region"
              required
              className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">
              {t("admin.chapters.form.lead_email")}
            </span>
            <input
              name="leadEmail"
              type="email"
              required
              className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("admin.chapters.form.submit")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
