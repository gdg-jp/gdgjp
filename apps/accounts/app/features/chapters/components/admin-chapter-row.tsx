import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Icons,
  Stack,
} from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Form, Link, useFetcher } from "react-router";
import type {
  actOnAdminChapters,
  loadAdminChapters,
} from "~/features/chapters/admin-chapters.server";
import type { RouteData } from "~/lib/route-data";

type PageProps = {
  loaderData: RouteData<typeof loadAdminChapters>;
  actionData?: RouteData<typeof actOnAdminChapters>;
};
export type ChapterRowData = PageProps["loaderData"]["chapters"][number];

export function ChapterActions({ chapter }: { chapter: ChapterRowData }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnAdminChapters>();
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

export function ChapterRow({ chapter, index }: { chapter: ChapterRowData; index: number }) {
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
