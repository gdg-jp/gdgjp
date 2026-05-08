import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowLeft, Check, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { toast } from "sonner";
import { PageShell } from "~/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  approveMembership,
  getChapterById,
  getMembership,
  getUserById,
  listAllPendingRequests,
  removeMembership,
} from "~/lib/db";
import { sendJoinRequestApproved, sendJoinRequestRejected } from "~/lib/email.server";
import { i18n } from "~/lib/i18n/i18n.server";
import { requireSuperAdmin } from "~/lib/permissions";
import type { Route } from "./+types/admin.requests";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

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
  requireSuperAdmin(user);
  const requests = await listAllPendingRequests(env.DB);
  return {
    user,
    requests,
    locale: await i18n.getLocale(args.request),
    title: t("meta.adminRequests"),
  };
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  const locale = (await i18n.getLocale(args.request)) === "ja" ? "ja" : "en";
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
  const intent = String(form.get("intent") ?? "");
  const userId = String(form.get("userId") ?? "");
  const chapterId = Number(form.get("chapterId"));
  if (!userId || !Number.isInteger(chapterId) || chapterId <= 0) {
    return { error: t("errors.unknownAction") };
  }
  const chapter = await getChapterById(env.DB, chapterId);
  if (!chapter) return { error: t("errors.chapterNotFound") };
  const membership = await getMembership(env.DB, userId, chapterId);
  if (!membership || membership.status !== "pending") {
    return { error: t("errors.userNotInChapter") };
  }

  if (intent === "approve") {
    await approveMembership(env.DB, userId, chapterId);
    const u = await getUserById(env.DB, userId);
    if (u?.email) {
      sendJoinRequestApproved(
        { env, ctx: args.context.cloudflare.ctx, locale },
        { chapter, userEmail: u.email },
      );
    }
    return { ok: true, intent: "approve" as const };
  }
  if (intent === "reject") {
    const u = await getUserById(env.DB, userId);
    await removeMembership(env.DB, userId, chapterId);
    if (u?.email) {
      sendJoinRequestRejected(
        { env, ctx: args.context.cloudflare.ctx, locale },
        { chapter, userEmail: u.email },
      );
    }
    return { ok: true, intent: "reject" as const };
  }
  return { error: t("errors.unknownAction") };
}

function formatRelative(now: number, then: number, locale: string): string {
  const seconds = Math.max(1, Math.round((now - then) / 1000));
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

export default function AdminRequests({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, requests, locale } = loaderData;
  const now = Math.floor(Date.now() / 1000);
  useEffect(() => {
    if (!actionData || "error" in actionData) return;
    if (actionData.intent === "approve") toast.success(t("adminRequests.toast.approved"));
    else if (actionData.intent === "reject") toast.success(t("adminRequests.toast.rejected"));
  }, [actionData, t]);
  return (
    <PageShell user={user} size="lg">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-3xl font-medium tracking-tight">{t("adminRequests.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminRequests.subtitle")}</p>
      </div>

      {actionData?.error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>{t("adminRequests.errorTitle")}</AlertTitle>
          <AlertDescription>{actionData.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("adminRequests.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("adminRequests.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminRequests.tableRequester")}</TableHead>
                  <TableHead>{t("adminRequests.tableChapter")}</TableHead>
                  <TableHead>{t("adminRequests.tableRequested")}</TableHead>
                  <TableHead className="text-right">{t("adminRequests.tableActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={`${r.userId}-${r.chapterId}`}>
                    <TableCell>
                      <div className="font-medium">{r.user.name || r.user.email}</div>
                      {r.user.name ? (
                        <div className="text-xs text-muted-foreground">{r.user.email}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/chapters/${r.chapter.slug}/organize`}
                        className="font-medium hover:underline"
                      >
                        {r.chapter.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">
                        {r.chapter.slug}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelative(now, r.createdAt, locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Form method="post">
                          <input type="hidden" name="intent" value="approve" />
                          <input type="hidden" name="userId" value={r.userId} />
                          <input type="hidden" name="chapterId" value={r.chapterId} />
                          <Button type="submit" size="sm">
                            <Check className="size-4" /> {t("adminRequests.approve")}
                          </Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="reject" />
                          <input type="hidden" name="userId" value={r.userId} />
                          <input type="hidden" name="chapterId" value={r.chapterId} />
                          <Button type="submit" size="sm" variant="outline">
                            <X className="size-4" /> {t("adminRequests.reject")}
                          </Button>
                        </Form>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
