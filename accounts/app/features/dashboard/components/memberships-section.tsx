import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  Heading,
  Icons,
  Inline,
  Stack,
  Text,
} from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import type { loadDashboard } from "~/features/dashboard/dashboard.server";
import { StatusBadge } from "~/features/memberships/components/status-badge";
import type { RouteData } from "~/lib/route-data";

type PageProps = { loaderData: RouteData<typeof loadDashboard> };
export function MembershipsSection({
  memberships,
  compact,
}: {
  memberships: PageProps["loaderData"]["memberships"];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (memberships.length === 0) {
    return (
      <Card>
        <Stack>
          <div className="flex size-10 items-center justify-center rounded-full bg-gdg-blue/10 text-gdg-blue">
            <Icons name="Compass" size={20} aria-hidden="true" />
          </div>
          <Heading level={2}>{t("dashboard.noChapter.title")}</Heading>
          <Text tone="muted">{t("dashboard.noChapter.description")}</Text>
        </Stack>
        <div className="mt-6">
          <Button asChild>
            <Link to="/onboarding" prefetch="intent">
              {t("dashboard.noChapter.cta")}{" "}
              <Icons name="ArrowRight" size={16} aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <section aria-labelledby="membership-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Heading level={2} id="membership-heading" className="text-lg">
            {t("dashboard.memberships.heading")}
          </Heading>
          {compact ? null : (
            <Text size="sm" tone="muted">
              {t("dashboard.memberships.description")}
            </Text>
          )}
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/chapters" prefetch="intent">
            <Icons name="Plus" size={16} aria-hidden="true" />{" "}
            {t("dashboard.memberships.browseCta")}
          </Link>
        </Button>
      </div>
      <ul className="space-y-3">
        {memberships.map((m, i) => (
          <MembershipRow
            key={`${m.userId}-${m.chapterId}`}
            membership={m}
            index={i}
            compact={compact}
          />
        ))}
      </ul>
    </section>
  );
}

export function MembershipRow({
  membership,
  index,
  compact,
}: {
  membership: PageProps["loaderData"]["memberships"][number];
  index: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const isLeaving = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "leave";
  const isPending = membership.status === "pending";
  const isOrganizer = membership.role === "organizer";
  const status = isPending ? "pending" : isOrganizer ? "organizer" : "member";
  const statusLabel = isPending
    ? t("dashboard.pending.badge")
    : isOrganizer
      ? t("dashboard.active.organizerBadge")
      : t("dashboard.active.memberBadge");
  const desc = isPending
    ? t("dashboard.pending.description")
    : isOrganizer
      ? t("dashboard.active.organizerDesc")
      : t("dashboard.active.memberDesc");
  const animationDelay = `${Math.min(index, 9) * 30}ms`;
  const exitCls = isLeaving ? "animate-out fade-out-0 zoom-out-95 duration-200" : "";
  return (
    <li
      className={`animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ${exitCls}`}
      style={{ animationDelay, animationFillMode: "both" }}
    >
      <Card>
        <Stack>
          <Inline className="justify-between">
            <div className="min-w-0">
              <Heading level={3} className="truncate text-base">
                {membership.chapter.name}
              </Heading>
              {compact ? null : (
                <Text size="xs" tone="muted" className="font-mono">
                  {membership.chapter.slug}
                </Text>
              )}
            </div>
            <StatusBadge status={status}>{statusLabel}</StatusBadge>
          </Inline>
          {compact ? null : (
            <Text size="sm" tone="muted">
              {desc}
            </Text>
          )}
        </Stack>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {isOrganizer && !isPending ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/chapters/${membership.chapter.slug}/organize`} prefetch="intent">
                <Icons name="Settings" size={16} aria-hidden="true" />
                {t("dashboard.memberships.manage")}
              </Link>
            </Button>
          ) : null}
          <LeaveDialog
            chapterId={membership.chapterId}
            chapterName={membership.chapter.name}
            isOrganizer={isOrganizer && !isPending}
            fetcher={fetcher}
            isLeaving={isLeaving}
            isPending={isPending}
          />
        </div>
      </Card>
    </li>
  );
}

export function LeaveDialog({
  chapterId,
  chapterName,
  isOrganizer,
  fetcher,
  isLeaving,
  isPending,
}: {
  chapterId: number;
  chapterName: string;
  isOrganizer: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  isLeaving: boolean;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  // Organizers should resign role before leaving; we still allow the dialog so
  // the server can return a clear "lastOrganizer" error when applicable.
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={isOrganizer ? "ghost" : "outline"} size="sm">
          <Icons name="Logout" size={16} aria-hidden="true" />
          {isPending ? t("dashboard.memberships.cancel") : t("dashboard.memberships.leave")}
        </Button>
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
            <Button type="button" variant="outline">
              {t("chapters.leaveDialog.cancel")}
            </Button>
          </AlertDialogCancel>
          <fetcher.Form method="post" action="/chapters">
            <input type="hidden" name="intent" value="leave" />
            <input type="hidden" name="chapterId" value={chapterId} />
            <AlertDialogAction asChild>
              <Button type="submit" variant="danger" loading={isLeaving}>
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
