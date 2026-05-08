import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowRight, ListChecks, LogOut, Plus, Settings2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { PageShell } from "~/components/page-shell";
import { StatusBadge } from "~/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { getAuth } from "~/lib/auth.server";
import { listMembershipsForUser } from "~/lib/db";
import { i18n } from "~/lib/i18n/i18n.server";
import type { Route } from "./+types/dashboard";

export async function loader(args: Route.LoaderArgs) {
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
  const memberships = await listMembershipsForUser(env.DB, user.id);
  return { user, memberships, title: t("meta.dashboard") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

function MembershipsSection({
  memberships,
}: { memberships: Route.ComponentProps["loaderData"]["memberships"] }) {
  const { t } = useTranslation();
  if (memberships.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.noChapter.title")}</CardTitle>
          <CardDescription>{t("dashboard.noChapter.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/chapters">
              {t("dashboard.noChapter.cta")} <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">{t("dashboard.memberships.heading")}</h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/chapters">
            <Plus className="size-4" /> {t("dashboard.memberships.browseCta")}
          </Link>
        </Button>
      </div>
      <ul className="space-y-3">
        {memberships.map((m) => (
          <MembershipRow key={`${m.userId}-${m.chapterId}`} membership={m} />
        ))}
      </ul>
    </div>
  );
}

function MembershipRow({
  membership,
}: { membership: Route.ComponentProps["loaderData"]["memberships"][number] }) {
  const { t } = useTranslation();
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
  return (
    <li>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{membership.chapter.name}</CardTitle>
              <CardDescription className="font-mono text-xs">
                {membership.chapter.slug}
              </CardDescription>
            </div>
            <StatusBadge status={status}>{statusLabel}</StatusBadge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{desc}</p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {isOrganizer && !isPending ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/chapters/${membership.chapter.slug}/organize`}>
                <Settings2 className="size-4" />
                {t("dashboard.memberships.manage")}
              </Link>
            </Button>
          ) : null}
          <LeaveDialog
            chapterId={membership.chapterId}
            chapterName={membership.chapter.name}
            isOrganizer={isOrganizer && !isPending}
          />
        </CardContent>
      </Card>
    </li>
  );
}

function LeaveDialog({
  chapterId,
  chapterName,
  isOrganizer,
}: {
  chapterId: number;
  chapterName: string;
  isOrganizer: boolean;
}) {
  const { t } = useTranslation();
  // Organizers should resign role before leaving; we still allow the dialog so
  // the server can return a clear "lastOrganizer" error when applicable.
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={isOrganizer ? "ghost" : "outline"} size="sm">
          <LogOut className="size-4" /> {t("dashboard.memberships.leave")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("chapters.leaveDialog.title", { name: chapterName })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("chapters.leaveDialog.desc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("chapters.leaveDialog.cancel")}</AlertDialogCancel>
          <Form method="post" action="/chapters">
            <input type="hidden" name="intent" value="leave" />
            <input type="hidden" name="chapterId" value={chapterId} />
            <AlertDialogAction type="submit">{t("chapters.leaveDialog.confirm")}</AlertDialogAction>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, memberships } = loaderData;
  return (
    <PageShell user={user}>
      <div className="space-y-1">
        <h1 className="text-3xl font-medium tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("dashboard.signedInAs", { email: user.email })}
        </p>
      </div>
      <div className="mt-6">
        <MembershipsSection memberships={memberships} />
      </div>
      {user.isAdmin ? (
        <Card className="mt-6 border-gdg-blue/30 bg-gdg-blue/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-gdg-blue" />
              <CardTitle className="text-base">{t("dashboard.superAdmin.title")}</CardTitle>
            </div>
            <CardDescription>{t("dashboard.superAdmin.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/requests">
                <ListChecks className="size-4" /> {t("dashboard.superAdmin.requestsCta")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/chapters">{t("dashboard.superAdmin.manageCta")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}
