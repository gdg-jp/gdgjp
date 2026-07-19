import type { AuthUser } from "@gdgjp/gdg-lib";
import { Check, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { SubmitButton } from "~/components/ui/submit-button";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import {
  type UserSummary,
  approveMembership,
  bustChaptersWithCountsCache,
  demoteMembershipUnlessLastOrganizer,
  getChapterBySlug,
  getMembership,
  getUserById,
  getUsersByIds,
  listMembersForChapter,
  listPendingForChapter,
  removeMembershipUnlessLastOrganizer,
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
    requireUser(env, args.request).then(
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
  const [t, viewerMembership, pending, members] = await Promise.all([
    i18n.getFixedT(args.request),
    getMembership(env.DB, user.id, chapter.id),
    listPendingForChapter(env.DB, chapter.id),
    listMembersForChapter(env.DB, chapter.id),
  ]);
  if (!canManageChapter(user, chapter.id, viewerMembership)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const ids = [...new Set([...pending.map((m) => m.userId), ...members.map((m) => m.userId)])];
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
  if (!target) return { error: t("errors.userNotInChapter") };

  switch (intent) {
    case "approve": {
      await approveMembership(env.DB, targetUserId, chapter.id);
      await bustChaptersWithCountsCache();
      const targetUser = await getUserById(env.DB, targetUserId);
      if (targetUser?.email) {
        sendJoinRequestApproved(
          { env, ctx: args.context.cloudflare.ctx, locale },
          { chapter, userEmail: targetUser.email },
        );
      }
      return null;
    }
    case "promote":
      await setRole(env.DB, targetUserId, "organizer", chapter.id);
      return null;
    case "demote": {
      const outcome = await demoteMembershipUnlessLastOrganizer(env.DB, targetUserId, chapter.id);
      if (outcome === "last_active_organizer") return { error: t("errors.lastOrganizer") };
      if (outcome === "not_found") return { error: t("errors.userNotInChapter") };
      return null;
    }
    case "remove": {
      const wasPending = target.status === "pending";
      const targetUser = wasPending ? await getUserById(env.DB, targetUserId) : null;
      const outcome = await removeMembershipUnlessLastOrganizer(env.DB, targetUserId, chapter.id);
      if (outcome === "last_active_organizer") return { error: t("errors.lastOrganizer") };
      if (outcome === "not_found") return { error: t("errors.userNotInChapter") };
      await bustChaptersWithCountsCache();
      if (wasPending && targetUser?.email) {
        sendJoinRequestRejected(
          { env, ctx: args.context.cloudflare.ctx, locale },
          { chapter, userEmail: targetUser.email },
        );
      }
      return null;
    }
    default:
      return { error: t("errors.unknownAction") };
  }
}

function userLabel(users: Record<string, UserSummary>, id: string) {
  const user = users[id];
  if (!user) return { name: id, email: "" };
  return { name: user.name || user.email || id, email: user.name ? user.email : "" };
}

type PendingMember = Route.ComponentProps["loaderData"]["pending"][number];
type ChapterMember = Route.ComponentProps["loaderData"]["members"][number];
type RowFetcher = ReturnType<typeof useFetcher<typeof action>>;
type MemberIntent = "promote" | "demote" | "remove";

function useToastError(fetcher: RowFetcher) {
  const { t } = useTranslation();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.error) return;
    toast.error(fetcher.data.error, { description: t("organize.errorTitle") });
  }, [fetcher.data, fetcher.state, t]);
}

function Person({ name, email }: { name: string; email: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{name}</p>
      {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
    </div>
  );
}

function ConfirmMemberAction({
  fetcher,
  userId,
  name,
  intent,
  compact = false,
}: {
  fetcher: RowFetcher;
  userId: string;
  name: string;
  intent: MemberIntent;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const isPending = fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent;
  const config = {
    promote: {
      label: t("organize.promote"),
      title: t("organize.dialog.promoteTitle", { name }),
      description: t("organize.dialog.promoteDescription"),
      confirm: t("organize.promote"),
      variant: "default" as const,
    },
    demote: {
      label: t("organize.demote"),
      title: t("organize.dialog.demoteTitle", { name }),
      description: t("organize.dialog.demoteDescription"),
      confirm: t("organize.demote"),
      variant: "outline" as const,
    },
    remove: {
      label: t("organize.remove"),
      title: t("organize.dialog.removeTitle", { name }),
      description: t("organize.dialog.removeDescription"),
      confirm: t("organize.remove"),
      variant: "destructive" as const,
    },
  }[intent];

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={config.variant}
          size={compact ? "sm" : "default"}
          disabled={fetcher.state !== "idle"}
          className={compact ? "w-full justify-start" : undefined}
        >
          {config.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{config.title}</AlertDialogTitle>
          <AlertDialogDescription>{config.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t("organize.dialog.cancel")}</AlertDialogCancel>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={intent} />
            <input type="hidden" name="userId" value={userId} />
            <SubmitButton
              variant={config.variant === "destructive" ? "destructive" : "default"}
              pending={isPending}
              pendingLabel={t("common.loading")}
            >
              {config.confirm}
            </SubmitButton>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PendingRow({
  member,
  users,
}: {
  member: PendingMember;
  users: Record<string, UserSummary>;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  useToastError(fetcher);
  const user = userLabel(users, member.userId);
  const isApproving = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "approve";
  const isRejecting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "remove";
  return (
    <li className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:rounded-none sm:border-x-0 sm:border-t-0 sm:px-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <UserRound className="size-4" aria-hidden="true" />
        </div>
        <Person {...user} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="approve" />
          <input type="hidden" name="userId" value={member.userId} />
          <SubmitButton
            className="w-full"
            size="sm"
            pending={isApproving}
            pendingLabel={t("common.loading")}
          >
            {isApproving ? null : <Check className="size-4" />}
            {t("organize.approve")}
          </SubmitButton>
        </fetcher.Form>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fetcher.state !== "idle"}
              className="w-full"
            >
              <X className="size-4" /> {t("organize.reject")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("organize.dialog.rejectTitle", { name: user.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("organize.dialog.rejectDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRejecting}>
                {t("organize.dialog.cancel")}
              </AlertDialogCancel>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="userId" value={member.userId} />
                <SubmitButton
                  variant="destructive"
                  pending={isRejecting}
                  pendingLabel={t("common.loading")}
                >
                  {t("organize.reject")}
                </SubmitButton>
              </fetcher.Form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function MemberActions({
  member,
  name,
  fetcher,
  isCurrentUser,
  compact,
}: {
  member: ChapterMember;
  name: string;
  fetcher: RowFetcher;
  isCurrentUser: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const isOrganizer = member.role === "organizer";
  if (isCurrentUser) {
    return <p className="text-xs text-muted-foreground">{t("organize.currentUser")}</p>;
  }
  return (
    <div className={compact ? "grid gap-2" : "flex flex-wrap justify-end gap-2"}>
      <ConfirmMemberAction
        fetcher={fetcher}
        userId={member.userId}
        name={name}
        intent={isOrganizer ? "demote" : "promote"}
        compact={compact}
      />
      <ConfirmMemberAction
        fetcher={fetcher}
        userId={member.userId}
        name={name}
        intent="remove"
        compact={compact}
      />
    </div>
  );
}

function MemberRow({
  member,
  users,
  viewerId,
}: {
  member: ChapterMember;
  users: Record<string, UserSummary>;
  viewerId: string;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  useToastError(fetcher);
  const user = userLabel(users, member.userId);
  const isOrganizer = member.role === "organizer";
  return (
    <li className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:rounded-none sm:border-x-0 sm:border-t-0 sm:px-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserRound className="size-4" aria-hidden="true" />
        </div>
        <Person {...user} />
      </div>
      <StatusBadge status={isOrganizer ? "organizer" : "member"}>
        {isOrganizer ? <ShieldCheck className="size-3" aria-hidden="true" /> : null}
        {isOrganizer ? t("organize.organizerBadge") : t("organize.memberBadge")}
      </StatusBadge>
      <MemberActions
        member={member}
        name={user.name}
        fetcher={fetcher}
        isCurrentUser={member.userId === viewerId}
      />
    </li>
  );
}

export default function OrganizeChapter({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, chapter, pending, members, users } = loaderData;
  const [query, setQuery] = useState("");
  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return members;
    return members.filter((member) => {
      const target = userLabel(users, member.userId);
      return `${target.name} ${target.email}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [members, query, users]);
  return (
    <PageShell user={user} size="lg">
      <PageHeader
        back={{ to: "/chapters", label: t("organize.back") }}
        title={t("organize.title", { chapter: chapter.name })}
      />

      <section aria-labelledby="pending-heading" className="mt-8">
        <Card className="overflow-hidden border-amber-500/25">
          <CardHeader className="bg-amber-500/5">
            <CardTitle id="pending-heading">
              {t("organize.pending", { count: pending.length })}
            </CardTitle>
            <CardDescription>{t("organize.pendingDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("organize.noPending")}</p>
            ) : (
              <ul className="space-y-3 sm:space-y-0">
                {pending.map((member) => (
                  <PendingRow key={member.userId} member={member} users={users} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="members-heading" className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle id="members-heading">
              {t("organize.members", { count: members.length })}
            </CardTitle>
            <CardDescription>{t("organize.membersDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {members.length > 0 ? (
              <div className="relative max-w-md">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("organize.search.placeholder")}
                  aria-label={t("organize.search.ariaLabel")}
                  className="pl-9"
                />
              </div>
            ) : null}
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("organize.noMembers")}</p>
            ) : filteredMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("organize.search.noMatches")}</p>
            ) : (
              <ul className="space-y-3 sm:space-y-0">
                {filteredMembers.map((member) => (
                  <MemberRow key={member.userId} member={member} users={users} viewerId={user.id} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
