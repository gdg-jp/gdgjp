import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, useFetcher, useNavigation } from "react-router";
import { PageShell } from "~/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SubmitButton } from "~/components/ui/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { getAuth } from "~/lib/auth.server";
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
    getAuth(env)
      .requireUser(args.request)
      .then(
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
    user = await getAuth(env).requireUser(args.request);
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
    if (!slug || !name || (kind !== "gdg" && kind !== "gdgoc")) {
      return { error: t("errors.fieldsRequired") };
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return { error: t("errors.slugFormat") };
    }
    try {
      await createChapter(env.DB, { slug, name, kind });
    } catch {
      return { error: t("errors.createChapterFailed") };
    }
    await bustChaptersWithCountsCache();
    return null;
  }
  return { error: t("errors.unknownAction") };
}

type ChapterRowData = Route.ComponentProps["loaderData"]["chapters"][number];

function ChapterRow({ chapter, index }: { chapter: ChapterRowData; index: number }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const isDeleting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "delete";
  const animationDelay = `${Math.min(index, 9) * 30}ms`;
  return (
    <TableRow
      className={`animate-in fade-in-0 duration-300 ${
        isDeleting ? "animate-out fade-out-0 duration-200" : ""
      }`}
      style={{ animationDelay, animationFillMode: "both" }}
    >
      <TableCell className="font-medium">{chapter.name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{chapter.slug}</TableCell>
      <TableCell>
        <span
          className={
            chapter.kind === "gdg"
              ? "font-mono text-xs text-gdg-blue"
              : "font-mono text-xs text-gdg-green"
          }
        >
          {chapter.kind === "gdg" ? t("kind.gdg") : t("kind.gdgoc")}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {chapter.activeCount}
        {chapter.pendingCount > 0 ? (
          <span className="ml-1 text-xs text-muted-foreground">(+{chapter.pendingCount})</span>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/chapters/${chapter.slug}/organize`} prefetch="intent">
              {t("admin.list.organize")}
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("admin.list.deleteAria", { name: chapter.name })}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("admin.list.dialogTitle", { name: chapter.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>{t("admin.list.dialogDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("admin.list.cancel")}</AlertDialogCancel>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={chapter.id} />
                  <SubmitButton
                    variant="destructive"
                    pending={isDeleting}
                    pendingLabel={t("common.loading")}
                  >
                    {t("admin.list.deleteConfirm")}
                  </SubmitButton>
                </fetcher.Form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function AdminChapters({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isCreating = navigation.state !== "idle" && navigation.formData?.get("intent") === "create";
  return (
    <PageShell user={loaderData.user}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard" prefetch="intent">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>

      <h1 className="text-3xl font-medium tracking-tight">{t("admin.title")}</h1>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("admin.create.cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="intent" value="create" />
            <div className="space-y-2">
              <Label htmlFor="slug">{t("admin.create.slugLabel")}</Label>
              <Input
                id="slug"
                name="slug"
                placeholder={t("admin.create.slugPlaceholder")}
                pattern="[a-z0-9-]+"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{t("admin.create.nameLabel")}</Label>
              <Input
                id="name"
                name="name"
                placeholder={t("admin.create.namePlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kind">{t("admin.create.kindLabel")}</Label>
              <Select name="kind" defaultValue="gdg">
                <SelectTrigger id="kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gdg">{t("kind.gdg")}</SelectItem>
                  <SelectItem value="gdgoc">{t("kind.gdgoc")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-3">
              <SubmitButton pending={isCreating} pendingLabel={t("admin.create.submitPending")}>
                {isCreating ? t("admin.create.submitPending") : t("admin.create.submit")}
              </SubmitButton>
            </div>
            {actionData?.error ? (
              <div className="sm:col-span-3">
                <Alert variant="destructive">
                  <AlertTitle>{t("admin.create.errorTitle")}</AlertTitle>
                  <AlertDescription>{actionData.error}</AlertDescription>
                </Alert>
              </div>
            ) : null}
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("admin.list.cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loaderData.chapters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.list.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.list.name")}</TableHead>
                  <TableHead>{t("admin.list.slug")}</TableHead>
                  <TableHead>{t("admin.list.kind")}</TableHead>
                  <TableHead className="text-right">{t("admin.list.members")}</TableHead>
                  <TableHead className="text-right">{t("admin.list.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaderData.chapters.map((c, i) => (
                  <ChapterRow key={c.id} chapter={c} index={i} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
