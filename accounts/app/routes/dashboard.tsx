import type { AuthUser } from "@gdgjp/gdg-lib";
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
import { Link, redirect, useFetcher } from "react-router";
import { PageShell } from "~/components/page-shell";
import { StatusBadge } from "~/components/status-badge";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import { listMembershipsForUser } from "~/lib/db";
import { i18n } from "~/lib/i18n/i18n.server";
import { shouldStartChapterOnboarding } from "~/lib/onboarding-policy";
import { hasOnboardingSkip } from "~/lib/onboarding-skip.server";
import { isOrganizerPlus } from "~/lib/permissions";
import type { Route } from "./+types/dashboard";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const [t, userResult] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (u) => ({ ok: true as const, user: u }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  const [memberships, skipped] = await Promise.all([
    listMembershipsForUser(env.DB, user.id),
    hasOnboardingSkip(args.request),
  ]);
  if (shouldStartChapterOnboarding(memberships.length, skipped)) {
    throw redirect("/onboarding");
  }
  return { user, memberships, title: t("meta.dashboard") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

function MembershipsSection({
  memberships,
  compact,
}: {
  memberships: Route.ComponentProps["loaderData"]["memberships"];
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

function MembershipRow({
  membership,
  index,
  compact,
}: {
  membership: Route.ComponentProps["loaderData"]["memberships"][number];
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

function LeaveDialog({
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

function MemberSimpleOidcLink() {
  const { t } = useTranslation();
  return (
    <div className="mt-8 text-sm text-muted">
      <Link
        to="/developers/apps"
        prefetch="intent"
        className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t("dashboard.memberSimple.oidcLink")}{" "}
        <Icons name="ArrowRight" size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

function GoogleWorkspaceLink() {
  const { t } = useTranslation();
  return (
    <div className="mt-4 text-sm text-muted">
      <Link
        to="/settings/google-workspace"
        prefetch="intent"
        className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t("dashboard.googleWorkspaceLink")}{" "}
        <Icons name="ArrowRight" size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

function RoleToolsSection({
  user,
  canRegisterApps,
  organizerMemberships,
}: {
  user: AuthUser;
  canRegisterApps: boolean;
  organizerMemberships: Route.ComponentProps["loaderData"]["memberships"];
}) {
  const { t } = useTranslation();
  if (!(canRegisterApps || organizerMemberships.length > 0 || user.isAdmin)) {
    return null;
  }
  return (
    <section aria-labelledby="role-tools-heading" className="mt-10 space-y-3">
      <div>
        <Heading level={2} id="role-tools-heading" className="text-lg">
          {t("dashboard.roleTools.heading")}
        </Heading>
        <Text size="sm" tone="muted">
          {t("dashboard.roleTools.description")}
        </Text>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {organizerMemberships.length > 0 ? (
          <Card>
            <Stack>
              <div className="flex items-center gap-2">
                <Icons name="Settings" size={16} aria-hidden="true" />
                <Heading level={3} className="text-base">
                  {t("dashboard.organizerTools.title")}
                </Heading>
              </div>
              <Text tone="muted">{t("dashboard.organizerTools.description")}</Text>
            </Stack>
            <div className="mt-6 flex flex-wrap gap-2">
              {organizerMemberships.map((membership) => (
                <Button asChild key={membership.chapterId} variant="outline" size="sm">
                  <Link to={`/chapters/${membership.chapter.slug}/organize`} prefetch="intent">
                    {membership.chapter.name}
                  </Link>
                </Button>
              ))}
            </div>
          </Card>
        ) : null}
        {canRegisterApps ? (
          <Card>
            <Stack>
              <div className="flex items-center gap-2">
                <Icons name="Key" size={16} aria-hidden="true" />
                <Heading level={3} className="text-base">
                  {t("dashboard.developerApps.title")}
                </Heading>
              </div>
              <Text tone="muted">{t("dashboard.developerApps.description")}</Text>
            </Stack>
            <div className="mt-6">
              <Button asChild variant="outline" size="sm">
                <Link to="/developers/apps" prefetch="intent">
                  {t("dashboard.developerApps.cta")}{" "}
                  <Icons name="ArrowRight" size={16} aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </Card>
        ) : null}
        {user.isAdmin ? (
          <Card className="md:col-span-2">
            <Stack>
              <div className="flex items-center gap-2">
                <Icons name="ShieldCheck" size={16} aria-hidden="true" />
                <Heading level={3} className="text-base">
                  {t("dashboard.superAdmin.title")}
                </Heading>
              </div>
              <Text tone="muted">{t("dashboard.superAdmin.description")}</Text>
            </Stack>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/users" prefetch="intent">
                  <Icons name="Users" size={16} aria-hidden="true" />{" "}
                  {t("dashboard.superAdmin.usersCta")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/requests" prefetch="intent">
                  <Icons name="List" size={16} aria-hidden="true" />{" "}
                  {t("dashboard.superAdmin.requestsCta")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/chapters" prefetch="intent">
                  {t("dashboard.superAdmin.manageCta")}
                </Link>
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </section>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { user, memberships } = loaderData;
  const canRegisterApps = memberships.some((membership) => membership.status === "active");
  const organizerMemberships = memberships.filter(
    (membership) => membership.status === "active" && membership.role === "organizer",
  );
  const organizerChrome = isOrganizerPlus(user, memberships);

  return (
    <PageShell user={user} size="lg">
      <div>
        <MembershipsSection memberships={memberships} compact={!organizerChrome} />
        <GoogleWorkspaceLink />
      </div>
      {organizerChrome ? (
        <RoleToolsSection
          user={user}
          canRegisterApps={canRegisterApps}
          organizerMemberships={organizerMemberships}
        />
      ) : canRegisterApps ? (
        <MemberSimpleOidcLink />
      ) : null}
    </PageShell>
  );
}
