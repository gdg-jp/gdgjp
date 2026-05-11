import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowLeft, Check, MoreHorizontal, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { PageShell } from "~/components/page-shell";
import { StatusBadge } from "~/components/status-badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SubmitButton } from "~/components/ui/submit-button";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { getAuth } from "~/lib/auth.server";
import {
  type UserSummary,
  approveMembership,
  bustChaptersWithCountsCache,
  getChapterBySlug,
  getMembership,
  getUserById,
  getUsersByIds,
  listMembersForChapter,
  listPendingForChapter,
  removeMembership,
  setRole,
} from "~/lib/db";
import { sendJoinRequestApproved, sendJoinRequestRejected } from "~/lib/email.server";
import { i18n } from "~/lib/i18n/i18n.server";
import { canManageChapter } from "~/lib/permissions";
import type { Route } from "./+types/chapters.$slug.organize";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

async function resolveUserAndChapter(args: Route.LoaderArgs | Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const slug = args.params.slug;
  if (!slug) throw new Response("Not found", { status: 404 });
  const [userResult, chapter] = await Promise.all([
    getAuth(env)
      .requireUser(args.request)
      .then(
        (u) => ({ ok: true as const, user: u }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
    getChapterBySlug(env.DB, slug),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  if (!chapter) throw new Response("Chapter not found", { status: 404 });
  return { env, user, chapter };
}

export async function loader(args: Route.LoaderArgs) {
  const { env, user, chapter } = await resolveUserAndChapter(args);
  // Membership check, both list queries, and i18n run in a single round-trip.
  const [t, viewerMembership, pending, members] = await Promise.all([
    i18n.getFixedT(args.request),
    getMembership(env.DB, user.id, chapter.id),
    listPendingForChapter(env.DB, chapter.id),
    listMembersForChapter(env.DB, chapter.id),
  ]);
  if (!canManageChapter(user, chapter.id, viewerMembership)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const idSet = new Set([...pending.map((m) => m.userId), ...members.map((m) => m.userId)]);
  const ids = [...idSet];
  const users = ids.length > 0 ? await getUsersByIds(env.DB, ids) : {};
  return {
    user,
    chapter,
    pending,
    members,
    users,
    title: t("meta.organize", { slug: chapter.slug }),
  };
}

export async function action(args: Route.ActionArgs) {
  const { env, chapter, user } = await resolveUserAndChapter(args);
  const [t, viewerMembership, rawLocale] = await Promise.all([
    i18n.getFixedT(args.request),
    getMembership(env.DB, user.id, chapter.id),
    i18n.getLocale(args.request),
  ]);
  if (!canManageChapter(user, chapter.id, viewerMembership)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const locale = rawLocale === "ja" ? "ja" : "en";
  const form = await args.request.formData();
  const intent = form.get("intent");
  const targetUserId = String(form.get("userId") ?? "");
  if (!targetUserId) return { error: t("errors.missingUser") };

  if (targetUserId === user.id) {
    if (intent === "demote") return { error: t("errors.cannotSelfDemote") };
    if (intent === "remove") return { error: t("errors.cannotSelfRemove") };
  }

  const target = await getMembership(env.DB, targetUserId, chapter.id);
  if (!target) {
    return { error: t("errors.userNotInChapter") };
  }

  switch (intent) {
    case "approve": {
      await approveMembership(env.DB, targetUserId, chapter.id);
      await bustChaptersWithCountsCache();
      const u = await getUserById(env.DB, targetUserId);
      if (u?.email) {
        sendJoinRequestApproved(
          { env, ctx: args.context.cloudflare.ctx, locale },
          { chapter, userEmail: u.email },
        );
      }
      return null;
    }
    case "promote":
      await setRole(env.DB, targetUserId, "organizer", chapter.id);
      return null;
    case "demote":
      await setRole(env.DB, targetUserId, "member", chapter.id);
      return null;
    case "remove": {
      const wasPending = target.status === "pending";
      const u = wasPending ? await getUserById(env.DB, targetUserId) : null;
      await removeMembership(env.DB, targetUserId, chapter.id);
      await bustChaptersWithCountsCache();
      if (wasPending && u?.email) {
        sendJoinRequestRejected(
          { env, ctx: args.context.cloudflare.ctx, locale },
          { chapter, userEmail: u.email },
        );
      }
      return null;
    }
    default:
      return { error: t("errors.unknownAction") };
  }
}

function userLabel(users: Record<string, UserSummary>, id: string) {
  const u = users[id];
  if (!u) return { name: id, email: "" };
  return { name: u.name || u.email || id, email: u.name ? u.email : "" };
}

type PendingMember = Route.ComponentProps["loaderData"]["pending"][number];
type ChapterMember = Route.ComponentProps["loaderData"]["members"][number];
type RowFetcher = ReturnType<typeof useFetcher<typeof action>>;

function useToastError(fetcher: RowFetcher) {
  const { t } = useTranslation();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) {
      toast.error(fetcher.data.error, { description: t("organize.errorTitle") });
    }
  }, [fetcher.state, fetcher.data, t]);
}

function PendingRow({
  member,
  users,
  index,
}: {
  member: PendingMember;
  users: Record<string, UserSummary>;
  index: number;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  useToastError(fetcher);
  const submittingIntent = fetcher.formData?.get("intent");
  const isApproving = fetcher.state !== "idle" && submittingIntent === "approve";
  const isRejecting = fetcher.state !== "idle" && submittingIntent === "remove";
  const isExiting = isApproving || isRejecting;
  const u = userLabel(users, member.userId);
  const animationDelay = `${Math.min(index, 9) * 30}ms`;
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ${
        isExiting ? "animate-out fade-out-0 zoom-out-95 duration-200" : ""
      }`}
      style={{ animationDelay, animationFillMode: "both" }}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{u.name}</div>
        {u.email ? <div className="truncate text-xs text-muted-foreground">{u.email}</div> : null}
      </div>
      <div className="flex items-center gap-2">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="userId" value={member.userId} />
          <SubmitButton size="sm" pending={isApproving} pendingLabel={t("common.loading")}>
            {isApproving ? null : <Check className="size-4" />}
            {t("organize.approve")}
          </SubmitButton>
        </fetcher.Form>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="remove" />
          <input type="hidden" name="userId" value={member.userId} />
          <SubmitButton
            size="sm"
            variant="outline"
            pending={isRejecting}
            pendingLabel={t("common.loading")}
          >
            {isRejecting ? null : <X className="size-4" />}
            {t("organize.reject")}
          </SubmitButton>
        </fetcher.Form>
      </div>
    </li>
  );
}

function MemberRow({
  member,
  users,
  index,
}: {
  member: ChapterMember;
  users: Record<string, UserSummary>;
  index: number;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  useToastError(fetcher);
  const submittingIntent = fetcher.formData?.get("intent");
  const isBusy = fetcher.state !== "idle";
  const isRemoving = isBusy && submittingIntent === "remove";
  const u = userLabel(users, member.userId);
  const isOrganizer = member.role === "organizer";
  const animationDelay = `${Math.min(index, 9) * 30}ms`;
  return (
    <li
      data-pending={isBusy || undefined}
      className={`flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 transition-opacity animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ${
        isBusy && !isRemoving ? "opacity-70" : ""
      } ${isRemoving ? "animate-out fade-out-0 zoom-out-95 duration-200" : ""}`}
      style={{ animationDelay, animationFillMode: "both" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <StatusBadge status={isOrganizer ? "organizer" : "member"}>
          {isOrganizer ? t("organize.organizerBadge") : t("organize.memberBadge")}
        </StatusBadge>
        <div className="min-w-0">
          <div className="truncate font-medium">{u.name}</div>
          {u.email ? <div className="truncate text-xs text-muted-foreground">{u.email}</div> : null}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("organize.manageAria", { name: u.name })}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={isOrganizer ? "demote" : "promote"} />
            <input type="hidden" name="userId" value={member.userId} />
            <DropdownMenuItem asChild>
              {/* onClick is required: Radix DropdownMenuItem swallows native submit otherwise */}
              <button type="submit" className="w-full text-left" onClick={() => {}}>
                {isOrganizer ? t("organize.demote") : t("organize.promote")}
              </button>
            </DropdownMenuItem>
          </fetcher.Form>
          <DropdownMenuSeparator />
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="remove" />
            <input type="hidden" name="userId" value={member.userId} />
            <DropdownMenuItem asChild variant="destructive">
              <button type="submit" className="w-full text-left" onClick={() => {}}>
                {t("organize.remove")}
              </button>
            </DropdownMenuItem>
          </fetcher.Form>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export default function OrganizeChapter({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, chapter, pending, members, users } = loaderData;
  return (
    <PageShell user={user}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard" prefetch="intent">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-3xl font-medium tracking-tight">
          {t("organize.title", { chapter: chapter.name })}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">{chapter.slug}</p>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("organize.pending", { count: pending.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("organize.noPending")}</p>
          ) : (
            <ul className="divide-y">
              {pending.map((m, i) => (
                <PendingRow key={m.userId} member={m} users={users} index={i} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("organize.members", { count: members.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("organize.noMembers")}</p>
          ) : (
            <ul className="divide-y">
              {members.map((m, i) => (
                <MemberRow key={m.userId} member={m} users={users} index={i} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
