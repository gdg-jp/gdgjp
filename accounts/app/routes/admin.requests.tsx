import type { AuthUser } from "@gdgjp/gdg-lib";
import { Check, Inbox, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
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
import { requireUser } from "~/lib/auth.server";
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
    requireUser(env, args.request).then(
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
    user = await requireUser(env, args.request);
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

function RequestActions({ req }: { req: RequestRowData }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
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
  );
}

function RequestRow({ req, locale, now }: { req: RequestRowData; locale: string; now: number }) {
  return (
    <TableRow>
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
      <TableCell>
        <div className="flex justify-end">
          <RequestActions req={req} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function RequestCard({ req, locale, now }: { req: RequestRowData; locale: string; now: number }) {
  const { t } = useTranslation();
  return (
    <li className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{req.user.name || req.user.email}</p>
          {req.user.name ? (
            <p className="truncate text-xs text-muted-foreground">{req.user.email}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelative(now, req.createdAt, locale)}
        </span>
      </div>
      <div className="rounded-md bg-muted/60 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t("adminRequests.tableChapter")}</p>
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

export default function AdminRequests({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, requests, locale, now } = loaderData;
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return requests;
    return requests.filter((request) =>
      [request.user.name, request.user.email, request.chapter.name, request.chapter.slug]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized)),
    );
  }, [query, requests]);
  return (
    <PageShell user={user} size="lg">
      <PageHeader
        eyebrow={t("nav.administration")}
        title={t("adminRequests.title")}
        description={t("adminRequests.subtitle")}
      />

      {requests.length > 0 ? (
        <div className="relative mt-6 max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("adminRequests.searchPlaceholder")}
            aria-label={t("adminRequests.searchPlaceholder")}
            className="pl-9"
          />
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("adminRequests.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <EmptyState icon={Inbox} title={t("adminRequests.empty")} className="border-0" />
          ) : filtered.length === 0 ? (
            <EmptyState title={t("adminRequests.noMatches")} className="border-0" />
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {filtered.map((request) => (
                  <RequestCard
                    key={`${request.userId}-${request.chapterId}`}
                    req={request}
                    locale={locale}
                    now={now}
                  />
                ))}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("adminRequests.tableRequester")}</TableHead>
                      <TableHead>{t("adminRequests.tableChapter")}</TableHead>
                      <TableHead>{t("adminRequests.tableRequested")}</TableHead>
                      <TableHead className="text-right">
                        {t("adminRequests.tableActions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <RequestRow
                        key={`${r.userId}-${r.chapterId}`}
                        req={r}
                        locale={locale}
                        now={now}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
