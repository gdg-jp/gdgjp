import { and, eq, gt, isNull, ne } from "drizzle-orm";
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
  const currentUser = await requireRole(request, env, "lead");
  const db = getDb(env);

  if (!currentUser.chapterId) {
    return { noChapter: true as const, chapter: null, members: [], pendingInvitations: [] };
  }

  const chapterId = currentUser.chapterId;

  const chapter = await db
    .select()
    .from(schema.chapters)
    .where(eq(schema.chapters.id, chapterId))
    .get();

  const members = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      image: schema.user.image,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(eq(schema.user.chapterId, chapterId))
    .all();

  const now = Math.floor(Date.now() / 1000);
  const pendingInvitations = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.chapterId, chapterId),
        gt(schema.invitations.expiresAt, now),
        isNull(schema.invitations.acceptedAt),
      ),
    )
    .all();

  const discordSetting = await db
    .select()
    .from(schema.discordGuildSettings)
    .where(eq(schema.discordGuildSettings.chapterId, chapterId))
    .get();

  return {
    noChapter: false as const,
    chapter,
    members,
    pendingInvitations,
    discordSetting: discordSetting ?? null,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const currentUser = await requireRole(request, env, "lead");
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const db = getDb(env);

  const chapterId = currentUser.chapterId;
  if (!chapterId) {
    return { error: "You are not assigned to a chapter." };
  }

  if (intent === "updateChapter") {
    const nameJa = (form.get("nameJa") as string).trim();
    const nameEn = (form.get("nameEn") as string).trim();
    const abbreviation = (form.get("abbreviation") as string).trim();
    const university = (form.get("university") as string).trim();
    const region = (form.get("region") as string).trim();

    if (!nameJa || !nameEn || !abbreviation || !university || !region) {
      return { updateError: "All fields are required." };
    }

    await db
      .update(schema.chapters)
      .set({ nameJa, nameEn, abbreviation, university, region })
      .where(eq(schema.chapters.id, chapterId));

    return { updateOk: true };
  }

  if (intent === "inviteMember") {
    const email = (form.get("email") as string).trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return { inviteError: "Invalid email address." };
    }

    const existing = await db
      .select()
      .from(schema.user)
      .where(and(eq(schema.user.email, email), eq(schema.user.chapterId, chapterId)))
      .get();

    if (existing) {
      return { inviteError: "This person is already a member of your chapter." };
    }

    const now = Math.floor(Date.now() / 1000);
    const existingInvitation = await db
      .select()
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.email, email),
          eq(schema.invitations.chapterId, chapterId),
          gt(schema.invitations.expiresAt, now),
          isNull(schema.invitations.acceptedAt),
        ),
      )
      .get();

    if (existingInvitation) {
      return { inviteError: "A pending invitation already exists for this email." };
    }

    const chapter = await db
      .select()
      .from(schema.chapters)
      .where(eq(schema.chapters.id, chapterId))
      .get();

    const token = crypto.randomUUID();
    const expiresAt = now + 7 * 24 * 60 * 60;

    await db.insert(schema.invitations).values({
      id: crypto.randomUUID(),
      email,
      chapterId,
      role: "member",
      invitedBy: currentUser.id,
      token,
      expiresAt,
    });

    await sendInvitationEmail(env, {
      to: email,
      role: "member",
      chapterName: chapter?.nameEn ?? chapterId,
      siteUrl: env.APP_URL,
    });

    return { inviteOk: true, invitedEmail: email };
  }

  if (intent === "updateDiscordSettings") {
    const guildId = (form.get("guildId") as string).trim();
    const reminderChannelId = (form.get("reminderChannelId") as string).trim();
    const enabled = form.get("enabled") === "1" ? 1 : 0;
    if (!guildId || !reminderChannelId) {
      return { discordError: "chapter.discord_error_required" };
    }
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
      return { discordError: "chapter.discord_error_guild_conflict" };
    }
    const now = new Date();
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
    return { discordOk: true };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChapterPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();

  if (data.noChapter) {
    return (
      <div className="px-8 py-12 text-center text-sm text-gray-500">{t("chapter.no_chapter")}</div>
    );
  }

  const { chapter, members, pendingInvitations, discordSetting } = data;

  return (
    <div className="max-w-4xl px-8 py-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        {chapter?.nameEn}
        {chapter?.nameJa && chapter.nameJa !== chapter.nameEn && (
          <span className="ml-2 text-lg font-normal text-gray-400">/ {chapter.nameJa}</span>
        )}
      </h1>

      {/* Section: Chapter Information */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("chapter.section_info")}</h2>

        {"updateOk" in (actionData ?? {}) && actionData?.updateOk && (
          <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            {t("chapter.update_success")}
          </div>
        )}
        {"updateError" in (actionData ?? {}) && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {(actionData as { updateError: string }).updateError}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <Form method="post" className="grid grid-cols-2 gap-4">
            <input type="hidden" name="intent" value="updateChapter" />

            <div className="col-span-2 grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">
                  {t("chapter.form.name_ja")}
                </span>
                <input
                  name="nameJa"
                  required
                  defaultValue={chapter?.nameJa ?? ""}
                  className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">
                  {t("chapter.form.name_en")}
                </span>
                <input
                  name="nameEn"
                  required
                  defaultValue={chapter?.nameEn ?? ""}
                  className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">
                {t("chapter.form.abbreviation")}
              </span>
              <input
                name="abbreviation"
                required
                defaultValue={chapter?.abbreviation ?? ""}
                className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">
                {t("chapter.form.university")}
              </span>
              <input
                name="university"
                required
                defaultValue={chapter?.university ?? ""}
                className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">{t("chapter.form.region")}</span>
              <input
                name="region"
                required
                defaultValue={chapter?.region ?? ""}
                className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <div className="col-span-2 flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                {t("chapter.form.save")}
              </button>
            </div>
          </Form>
        </div>
      </section>

      {/* Section: Discord Settings */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("chapter.section_discord")}</h2>

        {"discordOk" in (actionData ?? {}) && actionData?.discordOk && (
          <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            {t("chapter.update_success")}
          </div>
        )}
        {"discordError" in (actionData ?? {}) && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {t((actionData as { discordError: string }).discordError)}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <Form method="post" className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="intent" value="updateDiscordSettings" />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">
                {t("admin.chapters.discord.guild_id")}
              </span>
              <input
                name="guildId"
                defaultValue={discordSetting?.guildId ?? ""}
                placeholder="000000000000000000"
                className="w-52 rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">
                {t("admin.chapters.discord.channel_id")}
              </span>
              <input
                name="reminderChannelId"
                defaultValue={discordSetting?.reminderChannelId ?? ""}
                placeholder="000000000000000000"
                className="w-52 rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="flex items-center gap-2 pb-0.5 text-sm text-gray-600">
              <input
                type="checkbox"
                name="enabled"
                value="1"
                defaultChecked={(discordSetting?.enabled ?? 1) === 1}
                className="rounded border-gray-300"
              />
              {t("admin.chapters.discord.enabled")}
            </label>
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("admin.chapters.discord.save")}
            </button>
          </Form>
        </div>
      </section>

      {/* Section: Members */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("chapter.section_members")}</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  {t("chapter.col_user")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  {t("chapter.col_email")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  {t("chapter.col_role")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  {t("chapter.col_joined")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-500 text-xs font-medium text-white">
                        {m.image ? (
                          <img src={m.image} alt={m.name} className="h-full w-full object-cover" />
                        ) : (
                          (m.name[0]?.toUpperCase() ?? "?")
                        )}
                      </div>
                      <span className="font-medium text-gray-900">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3 text-gray-500">{m.role}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {members.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              {t("chapter.members_empty")}
            </p>
          )}
        </div>
      </section>

      {/* Section: Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            {t("chapter.section_pending")}
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    {t("chapter.col_email")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    {t("chapter.col_invited_at")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    {t("chapter.col_expires_at")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingInvitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{inv.email}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(inv.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(inv.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Section: Invite Member */}
      <section>
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("chapter.add_member")}</h2>

          {"inviteOk" in (actionData ?? {}) &&
            actionData?.inviteOk &&
            "invitedEmail" in (actionData ?? {}) && (
              <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
                {t("chapter.invite_sent", {
                  email: (actionData as { invitedEmail: string }).invitedEmail,
                })}
              </div>
            )}
          {"inviteError" in (actionData ?? {}) && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {(actionData as { inviteError: string }).inviteError}
            </div>
          )}

          <Form method="post" className="flex gap-3">
            <input type="hidden" name="intent" value="inviteMember" />
            <input
              name="email"
              type="email"
              required
              placeholder={t("chapter.email_placeholder")}
              className="flex-1 rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("chapter.form_submit_invite")}
            </button>
          </Form>
        </div>
      </section>
    </div>
  );
}
