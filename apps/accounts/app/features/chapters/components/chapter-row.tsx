import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  IconButton,
  Icons,
  Inline,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { toast } from "@gdgjp/design-system";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import type { ChapterState } from "~/features/chapters/chapters-shared";
import type { actOnChapters, loadChapters } from "~/features/chapters/chapters.server";
import { StatusBadge } from "~/features/memberships/components/status-badge";
import type { RouteData } from "~/lib/route-data";

type PageProps = {
  loaderData: RouteData<typeof loadChapters>;
  actionData?: RouteData<typeof actOnChapters>;
};
export type ChapterCardFetcher = ReturnType<typeof useFetcher<typeof actOnChapters>>;

export function ChapterRow({
  chapter,
  state,
}: {
  chapter: PageProps["loaderData"]["items"][number]["chapter"];
  state: ChapterState;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnChapters>();
  const kindLabel = chapter.kind === "gdg" ? t("kind.gdg") : t("kind.gdgoc");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data && fetcher.data.error) {
      toast.error(fetcher.data.error);
      return;
    }
    if ("intent" in fetcher.data) {
      if (fetcher.data.intent === "request") toast.success(t("chapters.toast.requested"));
      else if (fetcher.data.intent === "leave") toast.success(t("chapters.toast.left"));
    }
  }, [fetcher.state, fetcher.data, t]);

  return (
    <Inline className="flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
      <Stack className="min-w-0 flex-1 gap-1">
        <Text size="sm" className="break-words font-semibold">
          {chapter.name}
        </Text>
        <Text size="xs" tone="muted" className="break-all font-mono">
          {chapter.slug}
        </Text>
        <Inline className="gap-2">
          <Badge>{kindLabel}</Badge>
          <Inline className="gap-1.5 text-muted">
            <Icons name="Users" size={14} aria-hidden="true" />
            <Text size="xs" tone="muted">
              {t("chapters.memberCount", { count: chapter.activeCount })}
            </Text>
          </Inline>
          {state === "pending" ? (
            <StatusBadge status="pending">{t("dashboard.pending.badge")}</StatusBadge>
          ) : state === "active-member" ? (
            <StatusBadge status="member">{t("dashboard.active.memberBadge")}</StatusBadge>
          ) : state === "active-organizer" ? (
            <StatusBadge status="organizer">{t("dashboard.active.organizerBadge")}</StatusBadge>
          ) : null}
        </Inline>
      </Stack>
      <Stack className="gap-2 sm:w-48 sm:shrink-0">
        <ChapterAction chapter={chapter} state={state} fetcher={fetcher} />
        {fetcher.data && "error" in fetcher.data && fetcher.data.error ? (
          <Alert tone="danger" title={fetcher.data.error} />
        ) : null}
      </Stack>
    </Inline>
  );
}

export function ChapterAction({
  chapter,
  state,
  fetcher,
}: {
  chapter: PageProps["loaderData"]["items"][number]["chapter"];
  state: ChapterState;
  fetcher: ChapterCardFetcher;
}) {
  const { t } = useTranslation();
  const submittingIntent = fetcher.formData?.get("intent");
  const isRequesting = fetcher.state !== "idle" && submittingIntent === "request";
  const isLeaving = fetcher.state !== "idle" && submittingIntent === "leave";

  if (state === "joinable") {
    return (
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="request" />
        <input type="hidden" name="chapterId" value={chapter.id} />
        <Button type="submit" fullWidth loading={isRequesting}>
          {t("chapters.actions.request")}
          {isRequesting ? null : <Icons name="ArrowRight" size={16} aria-hidden="true" />}
        </Button>
      </fetcher.Form>
    );
  }
  if (state === "pending") {
    return (
      <LeaveButton
        chapterId={chapter.id}
        chapterName={chapter.name}
        variant="outline"
        fetcher={fetcher}
        isLeaving={isLeaving}
        isPending
      >
        {t("chapters.actions.cancel")}
      </LeaveButton>
    );
  }
  if (state === "active-organizer") {
    return (
      <div className="flex gap-2">
        <Button asChild variant="outline" className="min-w-0 flex-1">
          <Link to={`/chapters/${chapter.slug}/organize`} prefetch="intent">
            <Icons name="Settings" size={16} aria-hidden="true" />{" "}
            {t("dashboard.active.organizeCta")}
          </Link>
        </Button>
        <LeaveButton
          chapterId={chapter.id}
          chapterName={chapter.name}
          variant="outline"
          fetcher={fetcher}
          isLeaving={isLeaving}
          compact
        >
          <Icons name="Logout" size={16} aria-hidden="true" />
          <span className="sr-only">{t("chapters.actions.leave")}</span>
        </LeaveButton>
      </div>
    );
  }
  // active-member
  return (
    <LeaveButton
      chapterId={chapter.id}
      chapterName={chapter.name}
      variant="outline"
      fetcher={fetcher}
      isLeaving={isLeaving}
    >
      <Icons name="Logout" size={16} aria-hidden="true" /> {t("chapters.actions.leave")}
    </LeaveButton>
  );
}

export function LeaveButton({
  chapterId,
  chapterName,
  variant,
  children,
  fetcher,
  isLeaving,
  compact = false,
  isPending = false,
}: {
  chapterId: number;
  chapterName: string;
  variant: "outline" | "primary";
  children: ReactNode;
  fetcher: ChapterCardFetcher;
  isLeaving: boolean;
  compact?: boolean;
  isPending?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {compact ? (
          <IconButton
            variant={variant}
            className="shrink-0"
            aria-label={t("chapters.actions.leave")}
          >
            {children}
          </IconButton>
        ) : (
          <Button variant={variant} fullWidth size="md">
            {children}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Stack className="gap-2">
          <AlertDialogTitle>
            {isPending
              ? t("dashboard.memberships.cancelTitle", { name: chapterName })
              : t("chapters.leaveDialog.title", { name: chapterName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isPending
              ? t("dashboard.memberships.cancelDescription")
              : t("chapters.leaveDialog.desc")}
          </AlertDialogDescription>
        </Stack>
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={isLeaving}>
              {t("chapters.leaveDialog.cancel")}
            </Button>
          </AlertDialogCancel>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="leave" />
            <input type="hidden" name="chapterId" value={chapterId} />
            <AlertDialogAction asChild>
              <Button type="submit" variant={isPending ? "primary" : "danger"} loading={isLeaving}>
                {isPending
                  ? t("dashboard.memberships.cancelConfirm")
                  : t("chapters.leaveDialog.confirm")}
              </Button>
            </AlertDialogAction>
          </fetcher.Form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
