import { Button, Icons } from "@gdgjp/ui";
import { toast } from "@gdgjp/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import type {
  actOnAdminRequests,
  loadAdminRequests,
} from "~/features/memberships/admin-requests.server";
import type { RouteData } from "~/lib/route-data";

type PageProps = {
  loaderData: RouteData<typeof loadAdminRequests>;
  actionData?: RouteData<typeof actOnAdminRequests>;
};
export function formatRelative(now: number, then: number, locale: string): string {
  const seconds = Math.max(1, Math.round(now - then));
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];
  for (const [unit, secsPer] of units) {
    if (seconds >= secsPer || unit === "second") {
      return fmt.format(-Math.floor(seconds / secsPer), unit);
    }
  }
  return fmt.format(-seconds, "second");
}

export type RequestRowData = PageProps["loaderData"]["requests"][number];

export function RequestActions({ req }: { req: RequestRowData }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnAdminRequests>();
  const submittingIntent = fetcher.formData?.get("intent");
  const isApproving = fetcher.state !== "idle" && submittingIntent === "approve";
  const isRejecting = fetcher.state !== "idle" && submittingIntent === "reject";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data && fetcher.data.error) {
      toast.error(fetcher.data.error, { description: t("adminRequests.errorTitle") });
      return;
    }
    if ("intent" in fetcher.data) {
      if (fetcher.data.intent === "approve") toast.success(t("adminRequests.toast.approved"));
      else if (fetcher.data.intent === "reject") toast.success(t("adminRequests.toast.rejected"));
    }
  }, [fetcher.state, fetcher.data, t]);

  return (
    <div className="flex items-center gap-2">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="approve" />
        <input type="hidden" name="userId" value={req.userId} />
        <input type="hidden" name="chapterId" value={req.chapterId} />
        <Button type="submit" size="sm" loading={isApproving}>
          {isApproving ? null : <Icons name="Check" size={16} aria-hidden="true" />}
          {t("adminRequests.approve")}
        </Button>
      </fetcher.Form>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="reject" />
        <input type="hidden" name="userId" value={req.userId} />
        <input type="hidden" name="chapterId" value={req.chapterId} />
        <Button type="submit" size="sm" variant="outline" loading={isRejecting}>
          {isRejecting ? null : <Icons name="X" size={16} aria-hidden="true" />}
          {t("adminRequests.reject")}
        </Button>
      </fetcher.Form>
    </div>
  );
}

export function RequestRow({
  req,
  locale,
  now,
}: { req: RequestRowData; locale: string; now: number }) {
  return (
    <tr>
      <td>
        <div className="font-medium">{req.user.name || req.user.email}</div>
        {req.user.name ? <div className="text-xs text-muted">{req.user.email}</div> : null}
      </td>
      <td>
        <Link
          to={`/chapters/${req.chapter.slug}/organize`}
          prefetch="intent"
          className="font-medium hover:underline"
        >
          {req.chapter.name}
        </Link>
        <div className="font-mono text-xs text-muted">{req.chapter.slug}</div>
      </td>
      <td className="text-sm text-muted">{formatRelative(now, req.createdAt, locale)}</td>
      <td>
        <div className="flex justify-end">
          <RequestActions req={req} />
        </div>
      </td>
    </tr>
  );
}

export function RequestCard({
  req,
  locale,
  now,
}: { req: RequestRowData; locale: string; now: number }) {
  const { t } = useTranslation();
  return (
    <li className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{req.user.name || req.user.email}</p>
          {req.user.name ? <p className="truncate text-xs text-muted">{req.user.email}</p> : null}
        </div>
        <span className="shrink-0 text-xs text-muted">
          {formatRelative(now, req.createdAt, locale)}
        </span>
      </div>
      <div className="rounded-md bg-neutral px-3 py-2">
        <p className="text-xs text-muted">{t("adminRequests.tableChapter")}</p>
        <Link
          to={`/chapters/${req.chapter.slug}/organize`}
          prefetch="intent"
          className="mt-0.5 block font-medium hover:underline"
        >
          {req.chapter.name}
        </Link>
      </div>
      <RequestActions req={req} />
    </li>
  );
}
