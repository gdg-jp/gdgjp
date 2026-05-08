import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowLeft, Check, MoreHorizontal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { PageShell } from "~/components/page-shell";
import { StatusBadge } from "~/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { getAuth } from "~/lib/auth.server";
import {
  type UserSummary,
  approveMembership,
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

async function ensureAccess(args: Route.LoaderArgs | Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(args.request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw err;
  }
  const slug = args.params.slug;
  if (!slug) throw new Response("Not found", { status: 404 });
  const chapter = await getChapterBySlug(env.DB, slug);
  if (!chapter) throw new Response("Chapter not found", { status: 404 });
  const viewerMembership = await getMembership(env.DB, user.id, chapter.id);
  if (!canManageChapter(user, chapter.id, viewerMembership)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { env, user, chapter };
}

export async function loader(args: Route.LoaderArgs) {
  const { env, user, chapter } = await ensureAccess(args);
  const t = await i18n.getFixedT(args.request);
  const [pending, members] = await Promise.all([
    listPendingForChapter(env.DB, chapter.id),
    listMembersForChapter(env.DB, chapter.id),
  ]);
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
  const { env, chapter, user } = await ensureAccess(args);
  const t = await i18n.getFixedT(args.request);
  const locale = (await i18n.getLocale(args.request)) === "ja" ? "ja" : "en";
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

export default function OrganizeChapter({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { user, chapter, pending, members, users } = loaderData;
  return (
    <PageShell user={user}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-3xl font-medium tracking-tight">
          {t("organize.title", { chapter: chapter.name })}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">{chapter.slug}</p>
      </div>

      {actionData?.error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>{t("organize.errorTitle")}</AlertTitle>
          <AlertDescription>{actionData.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("organize.pending", { count: pending.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("organize.noPending")}</p>
          ) : (
            <ul className="divide-y">
              {pending.map((m) => {
                const u = userLabel(users, m.userId);
                return (
                  <li
                    key={m.userId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{u.name}</div>
                      {u.email ? (
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Form method="post">
                        <input type="hidden" name="intent" value="approve" />
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button type="submit" size="sm">
                          <Check className="size-4" /> {t("organize.approve")}
                        </Button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button type="submit" size="sm" variant="outline">
                          <X className="size-4" /> {t("organize.reject")}
                        </Button>
                      </Form>
                    </div>
                  </li>
                );
              })}
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
              {members.map((m) => {
                const u = userLabel(users, m.userId);
                const isOrganizer = m.role === "organizer";
                return (
                  <li
                    key={m.userId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <StatusBadge status={isOrganizer ? "organizer" : "member"}>
                        {isOrganizer ? t("organize.organizerBadge") : t("organize.memberBadge")}
                      </StatusBadge>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.name}</div>
                        {u.email ? (
                          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                        ) : null}
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
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value={isOrganizer ? "demote" : "promote"}
                          />
                          <input type="hidden" name="userId" value={m.userId} />
                          <DropdownMenuItem asChild>
                            <button type="submit" className="w-full text-left">
                              {isOrganizer ? t("organize.demote") : t("organize.promote")}
                            </button>
                          </DropdownMenuItem>
                        </Form>
                        <DropdownMenuSeparator />
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove" />
                          <input type="hidden" name="userId" value={m.userId} />
                          <DropdownMenuItem asChild variant="destructive">
                            <button type="submit" className="w-full text-left">
                              {t("organize.remove")}
                            </button>
                          </DropdownMenuItem>
                        </Form>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
