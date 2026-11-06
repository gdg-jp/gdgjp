import { Badge, Button, Card, FormField, Input, PageHeader, Switch } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { requireSpace } from "~/features/spaces/access.server";
import { FormSelect } from "~/features/spaces/components/FormSelect";
import {
  listSpaceMembers,
  removeSpaceMember,
  upsertSpaceMember,
} from "~/features/spaces/members.server";
import { ALLOWED_PRINCIPALS } from "~/features/spaces/shared";
import { updateSpaceSettings } from "~/features/spaces/spaces.server";
import { getDb } from "~/lib/db.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.space.name} — Space settings` : "Space settings" },
];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const { space } = await requireSpace(request, env, params.space, "owner");
  const members = await listSpaceMembers(getDb(env), space.id);
  return {
    space: {
      id: space.id,
      slug: space.slug,
      name: space.name,
      kind: space.kind,
      lang: space.lang,
      translateEnabled: space.translateEnabled,
    },
    members,
    // Only shared spaces take extra members (Stage 01 §2-b); Discord / Chat come from /setup.
    canAddMembers: ALLOWED_PRINCIPALS[space.kind].length > 0,
  };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const { space } = await requireSpace(request, env, params.space, "owner");
  const db = getDb(env);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "settings") {
    const result = await updateSpaceSettings(db, space, {
      name: String(form.get("name") ?? space.name),
      slug: form.has("slug") ? String(form.get("slug")) : undefined,
      lang: String(form.get("lang") ?? space.lang),
      translateEnabled: form.get("translateEnabled") === "on",
    });
    if (!result.ok) return { error: result.error };
    const nextSlug = form.has("slug") ? String(form.get("slug")).trim().toLowerCase() : space.slug;
    return redirect(`/spaces/${nextSlug}/settings`);
  }
  if (intent === "addMember") {
    const type = String(form.get("principalType") ?? "");
    const rawId = String(form.get("principalId") ?? "").trim();
    const principalId =
      type === "chapter_role" ? `${rawId}:${String(form.get("chapterRole") ?? "member")}` : rawId;
    const result = await upsertSpaceMember(db, space, {
      principalType: type,
      principalId,
      role: String(form.get("role") ?? "viewer"),
    });
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === "removeMember") {
    const result = await removeSpaceMember(db, space, {
      principalType: String(form.get("principalType") ?? ""),
      principalId: String(form.get("principalId") ?? ""),
    });
    return result.ok ? { ok: true } : { error: result.error };
  }
  return { error: "unknown_intent" };
}

export default function SpaceSettingsPage() {
  const { space, members, canAddMembers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();
  const error = actionData && "error" in actionData ? actionData.error : null;
  const slugEditable = space.kind === "shared" && space.id !== "gdg-jp";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title={t("spaces.settings_title", { name: space.name })}
        description={t(`spaces.kind_help.${space.kind}`)}
        back={
          <Link to="/spaces" className="text-sm text-primary underline-offset-2 hover:underline">
            {t("spaces.back_to_list")}
          </Link>
        }
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(`spaces.errors.${error}`, { defaultValue: error })}
        </p>
      )}

      <Card className="p-4">
        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="settings" />
          <FormField label={t("spaces.name")} required>
            <Input name="name" defaultValue={space.name} required maxLength={80} />
          </FormField>
          {slugEditable && (
            <FormField label={t("spaces.slug")} required>
              <Input name="slug" defaultValue={space.slug} required />
            </FormField>
          )}
          <FormSelect
            name="lang"
            label={t("spaces.lang")}
            defaultValue={space.lang}
            options={[
              { value: "ja", label: "日本語" },
              { value: "en", label: "English" },
            ]}
          />
          <FormField label={t("spaces.translate_enabled")}>
            <Switch name="translateEnabled" defaultChecked={space.translateEnabled} />
          </FormField>
          <div>
            <Button type="submit">{t("settings.save")}</Button>
          </div>
        </Form>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">{t("spaces.members")}</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={`${member.principalType}:${member.principalId}`}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {member.principalId === "*"
                      ? t(`spaces.wildcard.${member.principalType}`)
                      : member.label}
                  </p>
                  <p className="text-xs text-muted">
                    {t(`spaces.principal.${member.principalType}`)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge>{t(`spaces.role.${member.role}`)}</Badge>
                  {space.kind === "shared" && member.principalId !== "*" && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="removeMember" />
                      <input type="hidden" name="principalType" value={member.principalType} />
                      <input type="hidden" name="principalId" value={member.principalId} />
                      <Button type="submit" size="sm" variant="ghost">
                        {t("spaces.remove")}
                      </Button>
                    </Form>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>

        {canAddMembers && (
          <Card className="p-4">
            <Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="addMember" />
              <FormSelect
                name="principalType"
                label={t("spaces.principal_type")}
                options={[
                  { value: "user", label: t("spaces.principal.user") },
                  { value: "chapter_role", label: t("spaces.principal.chapter_role") },
                ]}
              />
              <FormField
                label={t("spaces.principal_id")}
                description={t("spaces.principal_id_help")}
                required
              >
                <Input name="principalId" required />
              </FormField>
              <FormSelect
                name="chapterRole"
                label={t("spaces.chapter_role")}
                options={[
                  { value: "member", label: "member" },
                  { value: "organizer", label: "organizer" },
                ]}
              />
              <FormSelect
                name="role"
                label={t("spaces.member_role")}
                options={[
                  { value: "viewer", label: t("spaces.role.viewer") },
                  { value: "editor", label: t("spaces.role.editor") },
                  { value: "owner", label: t("spaces.role.owner") },
                ]}
              />
              <div>
                <Button type="submit" variant="secondary">
                  {t("spaces.add_member")}
                </Button>
              </div>
            </Form>
          </Card>
        )}
      </section>
    </div>
  );
}
