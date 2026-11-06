import { Badge, Button, Card, FormField, Input, PageHeader } from "@gdgjp/design-system";
import { and, eq } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { listAccessibleSpaces, resolveSpaceAccess } from "~/features/spaces/access.server";
import { FormSelect } from "~/features/spaces/components/FormSelect";
import { spacePath } from "~/features/spaces/shared";
import {
  createChapterSpace,
  createPersonalSpace,
  createSharedSpace,
} from "~/features/spaces/spaces.server";
import { loadChapterDirectory } from "~/lib/chapter-directory.server";
import { getDb } from "~/lib/db.server";

export const meta: MetaFunction = () => [{ title: "Spaces — GDG Japan Wiki" }];

async function chapterNames(env: Env): Promise<Map<string, string>> {
  try {
    const directory = await loadChapterDirectory(env);
    return new Map(directory.map((chapter) => [chapter.id, chapter.name]));
  } catch {
    // The directory is cosmetic here; fall back to the chapter slug from claims.
    return new Map();
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);
  const access = await resolveSpaceAccess(db, identity);
  const spaces = await listAccessibleSpaces(db, access);

  const personal = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(and(eq(schema.spaces.kind, "personal"), eq(schema.spaces.createdBy, user.id)))
    .get();

  // Chapters this user organizes that do not have a space yet.
  const organized = identity.claimsAvailable
    ? identity.chapters.filter((chapter) => chapter.role === "organizer")
    : [];
  const existingChapterSpaces = new Set(
    (
      await db
        .select({ chapterId: schema.spaces.chapterId })
        .from(schema.spaces)
        .where(eq(schema.spaces.kind, "chapter"))
        .all()
    ).map((row) => row.chapterId),
  );
  const names = organized.length > 0 ? await chapterNames(env) : new Map<string, string>();
  const chapterCandidates = organized
    .filter((chapter) => !existingChapterSpaces.has(chapter.chapterId))
    .map((chapter) => ({
      chapterId: chapter.chapterId,
      name: names.get(chapter.chapterId) ?? chapter.chapterSlug,
    }));

  return {
    spaces: spaces.map((space) => ({
      id: space.id,
      slug: space.slug,
      name: space.name,
      kind: space.kind,
      role: space.role,
    })),
    hasPersonalSpace: !!personal,
    chapterCandidates,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);
  const form = await request.formData();
  const intent = form.get("intent");

  let result: Awaited<ReturnType<typeof createSharedSpace>>;
  if (intent === "createPersonal") {
    result = await createPersonalSpace(db, user);
  } else if (intent === "createChapter") {
    const chapterId = String(form.get("chapterId") ?? "");
    const claim = identity.chapters.find((chapter) => chapter.chapterId === chapterId);
    if (!claim && !user.isAdmin) return { error: "forbidden_chapter" };
    const names = await chapterNames(env);
    result = await createChapterSpace(
      db,
      { ...identity, user },
      { chapterId, name: names.get(chapterId) ?? claim?.chapterSlug ?? chapterId },
    );
  } else if (intent === "createShared") {
    result = await createSharedSpace(db, user, {
      slug: String(form.get("slug") ?? ""),
      name: String(form.get("name") ?? ""),
    });
  } else {
    return { error: "unknown_intent" };
  }
  if (!result.ok) return { error: result.error };
  return redirect(spacePath(result.space.slug));
}

const KIND_TONE = { personal: "info", chapter: "success", shared: "neutral" } as const;

export default function SpacesPage() {
  const { spaces, hasPersonalSpace, chapterCandidates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader title={t("spaces.title")} description={t("spaces.description")} />

      {actionData?.error && (
        <p role="alert" className="text-sm text-danger">
          {t(`spaces.errors.${actionData.error}`, { defaultValue: actionData.error })}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {spaces.map((space) => (
          <li key={space.id}>
            <Card className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link to={spacePath(space.slug)} className="font-medium text-foreground">
                  {space.name}
                </Link>
                <p className="text-sm text-muted">/s/{space.slug}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={KIND_TONE[space.kind as keyof typeof KIND_TONE] ?? "neutral"}>
                  {t(`spaces.kind.${space.kind}`)}
                </Badge>
                <Badge>{t(`spaces.role.${space.role}`)}</Badge>
                {space.role === "owner" && (
                  <Link
                    to={`/spaces/${space.slug}/settings`}
                    className="text-sm text-primary underline-offset-2 hover:underline"
                  >
                    {t("spaces.settings")}
                  </Link>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">{t("spaces.create_heading")}</h2>

        {!hasPersonalSpace && (
          <Form method="post" className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">{t("spaces.personal_help")}</p>
            <Button type="submit" name="intent" value="createPersonal" variant="secondary">
              {t("spaces.create_personal")}
            </Button>
          </Form>
        )}

        {chapterCandidates.length > 0 && (
          <Form method="post" className="flex flex-col gap-2">
            <p className="text-sm text-muted">{t("spaces.chapter_help")}</p>
            <div className="flex items-end gap-2">
              <FormSelect
                name="chapterId"
                label={t("spaces.chapter_select")}
                className="min-w-0 flex-1"
                options={chapterCandidates.map((chapter) => ({
                  value: chapter.chapterId,
                  label: chapter.name,
                }))}
              />
              <Button type="submit" name="intent" value="createChapter" variant="secondary">
                {t("spaces.create_chapter")}
              </Button>
            </div>
          </Form>
        )}

        <Form method="post" className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("spaces.shared_help")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <FormField label={t("spaces.name")} required className="min-w-0 flex-1">
              <Input name="name" required maxLength={80} />
            </FormField>
            <FormField label={t("spaces.slug")} required className="min-w-0 flex-1">
              <Input name="slug" required pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" />
            </FormField>
            <Button type="submit" name="intent" value="createShared">
              {t("spaces.create_shared")}
            </Button>
          </div>
        </Form>
      </section>
    </div>
  );
}
