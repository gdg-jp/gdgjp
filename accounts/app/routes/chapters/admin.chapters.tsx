import {
  Alert,
  Button,
  Card,
  Dialog,
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
} from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";
import { PageHeader } from "~/components/page-header";
import { actOnAdminChapters, loadAdminChapters } from "~/features/chapters/admin-chapters.server";
import { CHAPTER_REGIONS } from "~/features/chapters/chapter-regions";
import { ChapterActions, ChapterRow } from "~/features/chapters/components/admin-chapter-row";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/admin.chapters";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadAdminChapters(args);
}

export function action(args: Route.ActionArgs) {
  return actOnAdminChapters(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadAdminChapters>;
  actionData?: RouteData<typeof actOnAdminChapters>;
};

export default function AdminChapters({ loaderData, actionData }: PageProps) {
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
