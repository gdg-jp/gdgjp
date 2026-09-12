import type { AuthUser } from "@gdgjp/gdg-lib";
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  FormField,
  Heading,
  Icons,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  Text,
} from "@gdgjp/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useFetcher, useNavigation } from "react-router";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import { CHAPTER_REGIONS, isChapterRegion } from "~/lib/chapter-regions";
import {
  type ChapterKind,
  bustChaptersWithCountsCache,
  createChapter,
  deleteChapter,
  listChaptersWithCountsCached,
} from "~/lib/db";
import { i18n } from "~/lib/i18n/i18n.server";
import { requireSuperAdmin } from "~/lib/permissions";
import type { Route } from "./+types/admin.chapters";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  // listChaptersWithCountsCached doesn't depend on the user; fan it out with auth.
  const [t, userResult, chapters] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (u) => ({ ok: true as const, user: u }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    listChaptersWithCountsCached(env.DB),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  requireSuperAdmin(user);
  return { user, chapters, title: t("meta.adminChapters") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  let user: AuthUser;
  try {
    user = await requireUser(env, args.request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw err;
  }
  requireSuperAdmin(user);
  const form = await args.request.formData();
  const intent = form.get("intent");
  if (intent === "delete") {
    const id = Number(form.get("id"));
    if (Number.isInteger(id) && id > 0) {
      await deleteChapter(env.DB, id);
      await bustChaptersWithCountsCache();
    }
    return null;
  }
  if (intent === "create") {
    const slug = String(form.get("slug") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const kind = String(form.get("kind") ?? "") as ChapterKind;
    const regionRaw = String(form.get("region") ?? "").trim();
    if (!slug || !name || (kind !== "gdg" && kind !== "gdgoc") || !isChapterRegion(regionRaw)) {
      return { error: t("errors.fieldsRequired") };
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return { error: t("errors.slugFormat") };
    }
    try {
      await createChapter(env.DB, { slug, name, kind, region: regionRaw });
    } catch {
      return { error: t("errors.createChapterFailed") };
    }
    await bustChaptersWithCountsCache();
    return null;
  }
  return { error: t("errors.unknownAction") };
}

type ChapterRowData = Route.ComponentProps["loaderData"]["chapters"][number];

function ChapterActions({ chapter }: { chapter: ChapterRowData }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const isDeleting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "delete";
  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to={`/chapters/${chapter.slug}/organize`} prefetch="intent">
          {t("admin.list.organize")}
        </Link>
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Icons name="Delete" size={16} aria-hidden="true" />
            {t("admin.list.delete")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <Stack className="gap-2">
            <AlertDialogTitle>
              {t("admin.list.dialogTitle", { name: chapter.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("admin.list.dialogDesc")}</AlertDialogDescription>
          </Stack>
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                {t("admin.list.cancel")}
              </Button>
            </AlertDialogCancel>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={chapter.id} />
              <AlertDialogAction asChild>
                <Button type="submit" variant="danger" loading={isDeleting}>
                  {t("admin.list.deleteConfirm")}
                </Button>
              </AlertDialogAction>
            </fetcher.Form>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChapterRow({ chapter, index }: { chapter: ChapterRowData; index: number }) {
  const { t } = useTranslation();
  const animationDelay = `${Math.min(index, 9) * 30}ms`;
  return (
    <tr
      className="animate-in fade-in-0 duration-300"
      style={{ animationDelay, animationFillMode: "both" }}
    >
      <td className="font-medium">{chapter.name}</td>
      <td className="font-mono text-xs text-muted">{chapter.slug}</td>
      <td>
        <span
          className={
            chapter.kind === "gdg"
              ? "font-mono text-xs text-gdg-blue"
              : "font-mono text-xs text-gdg-green"
          }
        >
          {chapter.kind === "gdg" ? t("kind.gdg") : t("kind.gdgoc")}
        </span>
      </td>
      <td className="text-xs text-muted">{t(`region.${chapter.region}`)}</td>
      <td className="text-right tabular-nums">
        {chapter.activeCount}
        {chapter.pendingCount > 0 ? (
          <span className="ml-1 text-xs text-muted">(+{chapter.pendingCount})</span>
        ) : null}
      </td>
      <td className="text-right">
        <div className="flex justify-end">
          <ChapterActions chapter={chapter} />
        </div>
      </td>
    </tr>
  );
}

export default function AdminChapters({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isCreating = navigation.state !== "idle" && navigation.formData?.get("intent") === "create";
  const [createOpen, setCreateOpen] = useState(Boolean(actionData?.error));
  useEffect(() => {
    if (actionData?.error) setCreateOpen(true);
    else if (!isCreating && navigation.state === "idle") setCreateOpen(false);
  }, [actionData?.error, isCreating, navigation.state]);
  return (
    <PageShell user={loaderData.user} size="lg">
      <PageHeader
        title={t("admin.title")}
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Icons name="Plus" size={16} aria-hidden="true" />
                {t("admin.create.submit")}
              </Button>
            </DialogTrigger>
            <DialogContent closeLabel={t("common.close")}>
              <Stack className="gap-2">
                <DialogTitle>{t("admin.create.cardTitle")}</DialogTitle>
                <DialogDescription>{t("admin.create.description")}</DialogDescription>
              </Stack>
              <Form method="post" className="grid gap-4">
                <input type="hidden" name="intent" value="create" />
                <FormField id="slug" label={t("admin.create.slugLabel")} required>
                  <Input
                    name="slug"
                    placeholder={t("admin.create.slugPlaceholder")}
                    pattern="[a-z0-9-]+"
                    className="w-full"
                  />
                </FormField>
                <FormField id="name" label={t("admin.create.nameLabel")} required>
                  <Input
                    name="name"
                    placeholder={t("admin.create.namePlaceholder")}
                    className="w-full"
                  />
                </FormField>
                <FormField id="kind" label={t("admin.create.kindLabel")} required>
                  <Select name="kind" defaultValue="gdg">
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gdg">{t("kind.gdg")}</SelectItem>
                      <SelectItem value="gdgoc">{t("kind.gdgoc")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField id="region" label={t("admin.create.regionLabel")} required>
                  <Select name="region" defaultValue="kanto">
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHAPTER_REGIONS.map((region) => (
                        <SelectItem key={region} value={region}>
                          {t(`region.${region}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                {actionData?.error ? (
                  <Alert tone="danger" title={t("admin.create.errorTitle")}>
                    {actionData.error}
                  </Alert>
                ) : null}
                <div className="flex justify-end">
                  <Button type="submit" loading={isCreating}>
                    {t("admin.create.submit")}
                  </Button>
                </div>
              </Form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="mt-6">
        <Heading level={2}>{t("admin.list.cardTitle")}</Heading>
        <div className="mt-6">
          {loaderData.chapters.length === 0 ? (
            <EmptyState title={t("admin.list.empty")} />
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {loaderData.chapters.map((chapter) => (
                  <li key={chapter.id} className="space-y-4 py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{chapter.name}</p>
                        <p className="font-mono text-xs text-muted">{chapter.slug}</p>
                      </div>
                      <span
                        className={
                          chapter.kind === "gdg"
                            ? "text-xs text-gdg-blue"
                            : "text-xs text-gdg-green"
                        }
                      >
                        {chapter.kind === "gdg" ? t("kind.gdg") : t("kind.gdgoc")}
                      </span>
                    </div>
                    <p className="text-xs text-muted">{t(`region.${chapter.region}`)}</p>
                    <p className="text-sm text-muted">
                      {t("admin.list.memberSummary", {
                        active: chapter.activeCount,
                        pending: chapter.pendingCount,
                      })}
                    </p>
                    <ChapterActions chapter={chapter} />
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table scrollLabel={t("common.tableScroll")}>
                  <thead>
                    <tr>
                      <th>{t("admin.list.name")}</th>
                      <th>{t("admin.list.slug")}</th>
                      <th>{t("admin.list.kind")}</th>
                      <th>{t("admin.list.region")}</th>
                      <th className="text-right">{t("admin.list.members")}</th>
                      <th className="text-right">{t("admin.list.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaderData.chapters.map((c, i) => (
                      <ChapterRow key={c.id} chapter={c} index={i} />
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </div>
      </Card>
    </PageShell>
  );
}
