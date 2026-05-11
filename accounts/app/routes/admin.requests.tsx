import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowLeft, Check, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { PageShell } from "~/components/page-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  approveMembership,
  bustChaptersWithCountsCache,
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
  // None of these depend on each other — fan everything out in parallel.
  const [t, userResult, requests, locale] = await Promise.all([
    i18n.getFixedT(args.request),
    getAuth(env)
      .requireUser(args.request)
      .then(
        (u) => ({ ok: true as const, user: u }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
    listAllPendingRequests(env.DB),
    i18n.getLocale(args.request),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  requireSuperAdmin(user);
  return {
    user,
    requests,
    locale,
    now: Math.floor(Date.now() / 1000),
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
    await bustChaptersWithCountsCache();
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
    await bustChaptersWithCountsCache();
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

type RequestRowData = Route.ComponentProps["loaderData"]["requests"][number];

function RequestRow({
  req,
  index,
  locale,
  now,
}: { req: RequestRowData; index: number; locale: string; now: number }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const submittingIntent = fetcher.formData?.get("intent");
  const isApproving = fetcher.state !== "idle" && submittingIntent === "approve";
  const isRejecting = fetcher.state !== "idle" && submittingIntent === "reject";
  const isExiting = isApproving || isRejecting;
  const animationDelay = `${Math.min(index, 9) * 30}ms`;

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
    <TableRow
      className={`animate-in fade-in-0 duration-300 ${
        isExiting ? "animate-out fade-out-0 duration-200" : ""
      }`}
      style={{ animationDelay, animationFillMode: "both" }}
    >
      <TableCell>
        <div className="font-medium">{req.user.name || req.user.email}</div>
        {req.user.name ? (
          <div className="text-xs text-muted-foreground">{req.user.email}</div>
        ) : null}
      </TableCell>
      <TableCell>
        <Link
          to={`/chapters/${req.chapter.slug}/organize`}
          prefetch="intent"
          className="font-medium hover:underline"
        >
          {req.chapter.name}
        </Link>
        <div className="font-mono text-xs text-muted-foreground">{req.chapter.slug}</div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatRelative(now, req.createdAt, locale)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="approve" />
            <input type="hidden" name="userId" value={req.userId} />
            <input type="hidden" name="chapterId" value={req.chapterId} />
            <SubmitButton size="sm" pending={isApproving} pendingLabel={t("common.loading")}>
              {isApproving ? null : <Check className="size-4" />}
              {t("adminRequests.approve")}
            </SubmitButton>
          </fetcher.Form>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="reject" />
            <input type="hidden" name="userId" value={req.userId} />
            <input type="hidden" name="chapterId" value={req.chapterId} />
            <SubmitButton
              size="sm"
              variant="outline"
              pending={isRejecting}
              pendingLabel={t("common.loading")}
            >
              {isRejecting ? null : <X className="size-4" />}
              {t("adminRequests.reject")}
            </SubmitButton>
          </fetcher.Form>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function AdminRequests({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, requests, locale, now } = loaderData;
  return (
    <PageShell user={user} size="lg">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard" prefetch="intent">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-3xl font-medium tracking-tight">{t("adminRequests.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminRequests.subtitle")}</p>
      </div>

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
                {requests.map((r, i) => (
                  <RequestRow
                    key={`${r.userId}-${r.chapterId}`}
                    req={r}
                    index={i}
                    locale={locale}
                    now={now}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
