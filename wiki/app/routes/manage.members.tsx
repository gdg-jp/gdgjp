import { and, eq, gt, isNull } from "drizzle-orm";
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

  const chapterId = currentUser.chapterId ?? null;

  const members = chapterId
    ? await db
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
        .all()
    : [];

  const now = Math.floor(Date.now() / 1000);
  const pendingInvitations = chapterId
    ? await db
        .select()
        .from(schema.invitations)
        .where(
          and(
            eq(schema.invitations.chapterId, chapterId),
            gt(schema.invitations.expiresAt, now),
            isNull(schema.invitations.acceptedAt),
          ),
        )
        .all()
    : [];

  return { members, pendingInvitations, chapterId };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const currentUser = await requireRole(request, env, "lead");
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "inviteMember") {
    const email = (form.get("email") as string).trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return { error: "Invalid email address." };
    }

    const chapterId = currentUser.chapterId;
    if (!chapterId) {
      return { error: "You are not assigned to a chapter." };
    }

    const db = getDb(env);

    // Check not already a member of this chapter
    const existing = await db
      .select()
      .from(schema.user)
      .where(and(eq(schema.user.email, email), eq(schema.user.chapterId, chapterId)))
      .get();

    if (existing) {
      return { error: "This person is already a member of your chapter." };
    }

    // Check no pending invitation
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
      return { error: "A pending invitation already exists for this email." };
    }

    // Get chapter name for email
    const chapter = await db
      .select()
      .from(schema.chapters)
      .where(eq(schema.chapters.id, chapterId))
      .get();

    const token = crypto.randomUUID();
    const expiresAt = now + 7 * 24 * 60 * 60; // 7 days

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

    return { ok: true, invitedEmail: email };
  }

  return {};
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ManageMembers() {
  const { members, pendingInvitations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t("manage.members.heading")}</h1>

      {/* Flash */}
      {"ok" in (actionData ?? {}) && actionData?.ok && "invitedEmail" in (actionData ?? {}) && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {t("manage.members.invite_sent", {
            email: (actionData as { invitedEmail: string }).invitedEmail,
          })}
        </div>
      )}
      {"error" in (actionData ?? {}) && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {(actionData as { error: string }).error}
        </div>
      )}

      {/* Current members */}
      <div className="mb-8 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("manage.members.col_user")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("manage.members.col_email")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("manage.members.col_role")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {t("manage.members.col_joined")}
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
          <p className="px-4 py-8 text-center text-sm text-gray-400">{t("manage.members.empty")}</p>
        )}
      </div>

      {/* Pending invitations */}
      {pendingInvitations.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            {t("manage.members.pending_heading")}
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    {t("manage.members.col_email")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    {t("manage.members.col_invited_at")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    {t("manage.members.col_expires_at")}
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
        </div>
      )}

      {/* Invite form */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          {t("manage.members.add_member")}
        </h2>
        <Form method="post" className="flex gap-3">
          <input type="hidden" name="intent" value="inviteMember" />
          <input
            name="email"
            type="email"
            required
            placeholder={t("manage.members.email_placeholder")}
            className="flex-1 rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("manage.members.form.submit")}
          </button>
        </Form>
      </div>
    </div>
  );
}
