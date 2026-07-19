import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowRight, LogOut, Search, Settings2, Users } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { StatusBadge } from "~/components/status-badge";
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
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { SubmitButton } from "~/components/ui/submit-button";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import {
  bustChaptersWithCountsCache,
  getChapterById,
  getMembership,
  getOrganizerEmailsForChapter,
  getUserById,
  listChaptersWithCountsCached,
  listMembershipsForUser,
  removeOwnMembershipUnlessLastOrganizer,
  requestMembership,
} from "~/lib/db";
import { sendJoinRequestSubmitted, sendMemberLeft } from "~/lib/email.server";
import { i18n } from "~/lib/i18n/i18n.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/chapters";

type ChapterState = "joinable" | "pending" | "active-member" | "active-organizer";
type ChapterFilter = "all" | "joinable" | "mine" | "pending";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

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
  const [chapters, memberships] = await Promise.all([
    listChaptersWithCountsCached(env.DB),
    listMembershipsForUser(env.DB, user.id),
  ]);
  const byChapterId = new Map(memberships.map((m) => [m.chapterId, m]));
  const items = chapters.map((c) => {
    const m = byChapterId.get(c.id);
    let state: ChapterState = "joinable";
    if (m?.status === "pending") state = "pending";
    else if (m?.status === "active")
      state = m.role === "organizer" ? "active-organizer" : "active-member";
    return { chapter: c, state };
  });
  return { user, items, title: t("meta.chapters") };
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
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  const chapterId = Number(form.get("chapterId"));
  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    return { error: t("errors.selectChapter") };
  }

  if (intent === "request") {
    const result = await requestMembership(env.DB, user.id, chapterId);
    if (!result.ok) {
      return {
        error:
          result.reason === "chapter_not_found"
            ? t("errors.chapterNotFound")
            : t("errors.alreadyInChapter"),
      };
    }
    await bustChaptersWithCountsCache();
    const chapter = await getChapterById(env.DB, chapterId);
    if (chapter) {
      const organizerEmails = await getOrganizerEmailsForChapter(env.DB, chapterId);
      sendJoinRequestSubmitted(
        { env, ctx: args.context.cloudflare.ctx, locale },
        {
          chapter,
          requester: { id: user.id, email: user.email, name: user.name },
          organizerEmails,
        },
      );
    }
    return { ok: true, intent: "request" as const };
  }

  if (intent === "leave") {
    const chapter = await getChapterById(env.DB, chapterId);
    if (!chapter) return { error: t("errors.chapterNotFound") };
    const mine = await getMembership(env.DB, user.id, chapterId);
    if (!mine) return { error: t("errors.notInChapter") };
    const wasActive = mine.status === "active";
    const outcome = await removeOwnMembershipUnlessLastOrganizer(env.DB, user.id, chapterId);
    if (outcome === "not_found") return { error: t("errors.notInChapter") };
    if (outcome === "last_active_organizer") return { error: t("errors.lastOrganizer") };
    await bustChaptersWithCountsCache();
    if (wasActive) {
      const organizerEmails = await getOrganizerEmailsForChapter(env.DB, chapterId);
      const formerMember = (await getUserById(env.DB, user.id)) ?? {
        id: user.id,
        email: user.email,
        name: user.name,
      };
      sendMemberLeft(
        { env, ctx: args.context.cloudflare.ctx, locale },
        { chapter, formerMember, organizerEmails },
      );
    }
    return { ok: true, intent: "leave" as const };
  }

  return { error: t("errors.unknownAction") };
}

export default function ChaptersPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, items } = loaderData;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChapterFilter>("all");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(({ chapter, state }) => {
      const matchesQuery =
        !q || chapter.name.toLowerCase().includes(q) || chapter.slug.toLowerCase().includes(q);
      const matchesFilter =
        filter === "all" ||
        (filter === "joinable" && state === "joinable") ||
        (filter === "pending" && state === "pending") ||
        (filter === "mine" && (state === "active-member" || state === "active-organizer"));
      return matchesQuery && matchesFilter;
    });
  }, [filter, items, query]);
  const filters: { value: ChapterFilter; label: string }[] = [
    { value: "all", label: t("chapters.filters.all") },
    { value: "joinable", label: t("chapters.filters.joinable") },
    { value: "mine", label: t("chapters.filters.mine") },
    { value: "pending", label: t("chapters.filters.pending") },
  ];
  return (
    <PageShell user={user} size="lg">
      <PageHeader title={t("chapters.title")} />

      {items.length === 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">{t("chapters.empty.title")}</CardTitle>
            <CardDescription>{t("chapters.empty.description")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="mt-8 space-y-4">
            <div className="relative max-w-xl">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("chapters.search.placeholder")}
                aria-label={t("chapters.search.ariaLabel")}
                className="pl-9"
              />
            </div>
            <fieldset className="flex gap-2 overflow-x-auto pb-1">
              <legend className="sr-only">{t("chapters.filters.ariaLabel")}</legend>
              {filters.map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  variant={filter === item.value ? "default" : "outline"}
                  size="sm"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  className="shrink-0"
                >
                  {item.label}
                </Button>
              ))}
            </fieldset>
          </div>
          {filtered.length === 0 ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">{t("chapters.search.noMatches")}</CardTitle>
                <CardDescription>{t("chapters.search.noMatchesDescription")}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="mt-4 divide-y overflow-x-auto rounded-xl border bg-card">
              {filtered.map(({ chapter, state }) => (
                <ChapterRow key={chapter.id} chapter={chapter} state={state} />
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

type ChapterCardFetcher = ReturnType<typeof useFetcher<typeof action>>;

function ChapterRow({
  chapter,
  state,
}: {
  chapter: Route.ComponentProps["loaderData"]["items"][number]["chapter"];
  state: ChapterState;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const accent = chapter.kind === "gdg" ? "text-gdg-blue" : "text-gdg-green";
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
    <div className="flex min-h-14 min-w-[760px] items-center gap-3 bg-card px-4 py-2 transition-colors hover:bg-muted/35">
      <div className="w-56 min-w-0 shrink-0">
        <p className="truncate text-sm font-semibold" title={chapter.name}>
          {chapter.name}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground" title={chapter.slug}>
          {chapter.slug}
        </p>
      </div>

      <span className={cn("w-20 shrink-0 font-mono text-xs", accent)}>{kindLabel}</span>

      <span className="min-w-0 flex-1" />

      <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden="true" />
        {t("chapters.memberCount", { count: chapter.activeCount })}
      </span>

      <div className="flex w-24 shrink-0 justify-start">
        {state === "pending" ? (
          <StatusBadge status="pending">{t("dashboard.pending.badge")}</StatusBadge>
        ) : state === "active-member" ? (
          <StatusBadge status="member">{t("dashboard.active.memberBadge")}</StatusBadge>
        ) : state === "active-organizer" ? (
          <StatusBadge status="organizer">{t("dashboard.active.organizerBadge")}</StatusBadge>
        ) : null}
      </div>

      <div className="w-48 shrink-0">
        <ChapterAction chapter={chapter} state={state} fetcher={fetcher} />
      </div>
    </div>
  );
}

function ChapterAction({
  chapter,
  state,
  fetcher,
}: {
  chapter: Route.ComponentProps["loaderData"]["items"][number]["chapter"];
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
        <SubmitButton className="w-full" pending={isRequesting} pendingLabel={t("common.loading")}>
          {t("chapters.actions.request")}
          {isRequesting ? null : <ArrowRight className="size-4" />}
        </SubmitButton>
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
            <Settings2 className="size-4" /> {t("dashboard.active.organizeCta")}
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
          <LogOut className="size-4" />
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
      <LogOut className="size-4" /> {t("chapters.actions.leave")}
    </LeaveButton>
  );
}

function LeaveButton({
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
  variant: "outline" | "default";
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
        <Button
          variant={variant}
          className={compact ? "shrink-0" : "w-full"}
          size={compact ? "icon" : "default"}
        >
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
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
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLeaving}>
            {t("chapters.leaveDialog.cancel")}
          </AlertDialogCancel>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="leave" />
            <input type="hidden" name="chapterId" value={chapterId} />
            <SubmitButton
              variant={isPending ? "default" : "destructive"}
              pending={isLeaving}
              pendingLabel={t("common.loading")}
            >
              {isPending
                ? t("dashboard.memberships.cancelConfirm")
                : t("chapters.leaveDialog.confirm")}
            </SubmitButton>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
