import type { AuthUser } from "@gdgjp/gdg-lib";
import { Check, KeyRound, Search, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useFetcher } from "react-router";
import { toast } from "sonner";
import { EmptyState } from "~/components/empty-state";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
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
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
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
import { listChapters } from "~/lib/db";
import { i18n } from "~/lib/i18n/i18n.server";
import { requireSuperAdmin } from "~/lib/permissions";
import {
  listManagedUsers,
  revokeUserSessions,
  setUserAdmin,
  setUserChapters,
} from "~/lib/user-admin.server";
import type { Route } from "./+types/admin.users";

const PAGE_SIZE = 25;

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const [t, userResult, locale] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (user) => ({ ok: true as const, user }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    i18n.getLocale(args.request),
  ]);
  if (!userResult.ok) {
    if (userResult.error instanceof Response && userResult.error.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.error;
  }
  requireSuperAdmin(userResult.user);

  const url = new URL(args.request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const requestedPage = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [result, chapters] = await Promise.all([
    listManagedUsers(env.DB, { query, page, pageSize: PAGE_SIZE }),
    listChapters(env.DB),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (page > pages) throw redirect(pageUrl(query, pages));
  return {
    ...result,
    chapters,
    query,
    user: userResult.user,
    locale,
    title: t("meta.adminUsers"),
  };
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  let actor: AuthUser;
  try {
    actor = await requireUser(env, args.request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw error;
  }
  requireSuperAdmin(actor);

  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  const targetId = String(form.get("userId") ?? "");
  if (!targetId) return { error: t("adminUsers.errors.notFound") };

  if (intent === "set-admin") {
    if (targetId === actor.id) return { error: t("adminUsers.errors.selfAdmin") };
    const isAdmin = form.get("isAdmin") === "true";
    const result = await setUserAdmin(env.DB, { actorId: actor.id, targetId, isAdmin });
    if (result.status === "not_found") return { error: t("adminUsers.errors.notFound") };
    if (result.status === "last_admin") return { error: t("adminUsers.errors.lastAdmin") };
    return { ok: true, intent: isAdmin ? ("promote" as const) : ("demote" as const) };
  }

  if (intent === "revoke-sessions") {
    const result = await revokeUserSessions(env.DB, { actorId: actor.id, targetId });
    if (result.status === "not_found") return { error: t("adminUsers.errors.notFound") };
    if (result.status === "self_revoke") return { error: t("adminUsers.errors.selfRevoke") };
    return { ok: true, intent: "revoke" as const };
  }

  if (intent === "set-chapter") {
    const chapterIds = form
      .getAll("chapterIds")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    if (chapterIds.length === 0) {
      return { error: t("errors.selectChapter") };
    }
    const result = await setUserChapters(env.DB, { targetId, chapterIds });
    if (result.status === "not_found") return { error: t("adminUsers.errors.notFound") };
    if (result.status === "chapter_not_found") return { error: t("errors.chapterNotFound") };
    if (result.status === "last_active_organizer") {
      return { error: t("adminUsers.errors.lastActiveOrganizer") };
    }
    return { ok: true, intent: "chapter" as const };
  }

  return { error: t("adminUsers.errors.unknown") };
}

type ManagedUser = Route.ComponentProps["loaderData"]["users"][number];

function initials(name: string, email: string) {
  const value = name.trim() || email;
  return value.slice(0, 2).toUpperCase();
}

function formatCreatedAt(value: number | string, locale: string) {
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function UserActions({
  item,
  actorId,
  chapters,
}: {
  item: ManagedUser;
  actorId: string;
  chapters: Route.ComponentProps["loaderData"]["chapters"];
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const isSelf = item.id === actorId;
  const busy = fetcher.state !== "idle";
  const [chapterOpen, setChapterOpen] = useState(false);
  const [chapterQuery, setChapterQuery] = useState("");
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data && fetcher.data.error) {
      toast.error(fetcher.data.error);
      return;
    }
    if ("intent" in fetcher.data) {
      toast.success(t(`adminUsers.toast.${fetcher.data.intent}`));
      if (fetcher.data.intent === "chapter") setChapterOpen(false);
    }
  }, [fetcher.data, fetcher.state, t]);

  const displayName = item.name || item.email;
  const selectedChapters = chapters.filter((chapter) => selectedChapterIds.includes(chapter.id));
  const chapterResults = chapters.filter((chapter) => {
    const query = chapterQuery.trim().toLocaleLowerCase();
    return !query || `${chapter.name} ${chapter.slug}`.toLocaleLowerCase().includes(query);
  });

  function setDialogOpen(open: boolean) {
    setChapterOpen(open);
    if (open) setSelectedChapterIds(item.activeChapterIds);
    setChapterQuery("");
  }

  function toggleChapter(chapterId: number) {
    setSelectedChapterIds((current) =>
      current.includes(chapterId)
        ? current.filter((id) => id !== chapterId)
        : [...current, chapterId],
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Dialog open={chapterOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || chapters.length === 0}
          >
            {t("adminUsers.changeChapter")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("adminUsers.dialog.changeChapterTitle", { name: displayName })}
            </DialogTitle>
            <DialogDescription>{t("adminUsers.dialog.changeChapterDescription")}</DialogDescription>
          </DialogHeader>
          <fetcher.Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="set-chapter" />
            <input type="hidden" name="userId" value={item.id} />
            {selectedChapterIds.map((chapterId) => (
              <input key={chapterId} type="hidden" name="chapterIds" value={chapterId} />
            ))}
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{t("adminUsers.chapterLabel")}</p>
                <p className="text-sm text-muted-foreground">{t("adminUsers.chapterHelp")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedChapters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("adminUsers.chapterSelectedEmpty")}
                  </p>
                ) : (
                  selectedChapters.map((chapter) => (
                    <Button
                      key={chapter.id}
                      type="button"
                      variant="secondary"
                      size="xs"
                      onClick={() => toggleChapter(chapter.id)}
                    >
                      {chapter.name}
                      <X className="size-3" aria-hidden="true" />
                      <span className="sr-only">
                        {t("adminUsers.removeChapter", { name: chapter.name })}
                      </span>
                    </Button>
                  ))
                )}
              </div>
              <Input
                type="search"
                value={chapterQuery}
                onChange={(event) => setChapterQuery(event.target.value)}
                placeholder={t("adminUsers.chapterSearchPlaceholder")}
                aria-label={t("adminUsers.chapterSearchPlaceholder")}
              />
              <div className="max-h-52 overflow-y-auto rounded-md border p-1">
                {chapterResults.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {t("adminUsers.chapterNoMatches")}
                  </p>
                ) : (
                  chapterResults.map((chapter) => {
                    const selected = selectedChapterIds.includes(chapter.id);
                    return (
                      <Button
                        key={chapter.id}
                        type="button"
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => toggleChapter(chapter.id)}
                      >
                        <span className="flex size-4 items-center justify-center">
                          {selected ? <Check className="size-4" aria-hidden="true" /> : null}
                        </span>
                        {chapter.name}
                        <span className="ml-auto font-mono text-xs text-muted-foreground">
                          {chapter.slug}
                        </span>
                      </Button>
                    );
                  })
                )}
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  {t("adminUsers.dialog.cancel")}
                </Button>
              </DialogClose>
              <SubmitButton pending={busy} pendingLabel={t("common.loading")}>
                {t("adminUsers.changeChapter")}
              </SubmitButton>
            </DialogFooter>
          </fetcher.Form>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={busy || isSelf}>
            {item.isAdmin ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
            {item.isAdmin ? t("adminUsers.demote") : t("adminUsers.promote")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                item.isAdmin ? "adminUsers.dialog.demoteTitle" : "adminUsers.dialog.promoteTitle",
                { name: displayName },
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                item.isAdmin
                  ? "adminUsers.dialog.demoteDescription"
                  : "adminUsers.dialog.promoteDescription",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminUsers.dialog.cancel")}</AlertDialogCancel>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="set-admin" />
              <input type="hidden" name="userId" value={item.id} />
              <input type="hidden" name="isAdmin" value={item.isAdmin ? "false" : "true"} />
              <SubmitButton pending={busy} pendingLabel={t("common.loading")}>
                {item.isAdmin ? t("adminUsers.demote") : t("adminUsers.promote")}
              </SubmitButton>
            </fetcher.Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={busy || isSelf}>
            <KeyRound className="size-4" />
            {t("adminUsers.revoke")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminUsers.dialog.revokeTitle", { name: displayName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminUsers.dialog.revokeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminUsers.dialog.cancel")}</AlertDialogCancel>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="revoke-sessions" />
              <input type="hidden" name="userId" value={item.id} />
              <SubmitButton variant="destructive" pending={busy} pendingLabel={t("common.loading")}>
                {t("adminUsers.revoke")}
              </SubmitButton>
            </fetcher.Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function pageUrl(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/admin/users?${search}` : "/admin/users";
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { users, total, page, pageSize, query, locale, user, chapters } = loaderData;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PageShell user={user} size="lg">
      <PageHeader title={t("adminUsers.title")} />

      <Form method="get" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("adminUsers.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Button type="submit">{t("adminUsers.search")}</Button>
        {query ? (
          <Button asChild variant="outline">
            <Link to="/admin/users">{t("adminUsers.clear")}</Link>
          </Button>
        ) : null}
      </Form>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("adminUsers.resultCount", { count: total })}</span>
        <span>{t("adminUsers.page", { page, pages })}</span>
      </div>

      <Card className="mt-3 overflow-hidden py-0">
        <CardContent className="p-0">
          {users.length === 0 ? (
            <EmptyState title={t("adminUsers.empty")} className="border-0" />
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {users.map((item) => (
                  <li key={item.id} className="space-y-4 p-4">
                    <div className="flex items-start gap-3">
                      <Avatar>
                        {item.image ? <AvatarImage src={item.image} alt="" /> : null}
                        <AvatarFallback>{initials(item.name, item.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.name || item.email}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.email}</div>
                      </div>
                      <Badge variant={item.isAdmin ? "default" : "secondary"}>
                        {item.isAdmin ? t("adminUsers.adminBadge") : t("adminUsers.userBadge")}
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("adminUsers.table.memberships")}
                        </dt>
                        <dd className="mt-1">
                          {t("adminUsers.activeMemberships", {
                            active: item.activeMembershipCount,
                            total: item.membershipCount,
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("adminUsers.table.sessions")}
                        </dt>
                        <dd className="mt-1 tabular-nums">{item.sessionCount}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("adminUsers.table.created")}
                        </dt>
                        <dd className="mt-1">{formatCreatedAt(item.createdAt, locale)}</dd>
                      </div>
                    </dl>
                    <UserActions item={item} actorId={user.id} chapters={chapters} />
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("adminUsers.table.user")}</TableHead>
                      <TableHead>{t("adminUsers.table.memberships")}</TableHead>
                      <TableHead>{t("adminUsers.table.sessions")}</TableHead>
                      <TableHead>{t("adminUsers.table.created")}</TableHead>
                      <TableHead>{t("adminUsers.table.role")}</TableHead>
                      <TableHead className="text-right">{t("adminUsers.table.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex min-w-56 items-center gap-3">
                            <Avatar>
                              {item.image ? <AvatarImage src={item.image} alt="" /> : null}
                              <AvatarFallback>{initials(item.name, item.email)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{item.name || item.email}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {item.email}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {t("adminUsers.activeMemberships", {
                            active: item.activeMembershipCount,
                            total: item.membershipCount,
                          })}
                        </TableCell>
                        <TableCell className="tabular-nums">{item.sessionCount}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatCreatedAt(item.createdAt, locale)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.isAdmin ? "default" : "secondary"}>
                            {item.isAdmin ? t("adminUsers.adminBadge") : t("adminUsers.userBadge")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <UserActions item={item} actorId={user.id} chapters={chapters} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-end gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            {t("adminUsers.previous")}
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to={pageUrl(query, page - 1)}>{t("adminUsers.previous")}</Link>
          </Button>
        )}
        {page >= pages ? (
          <Button variant="outline" size="sm" disabled>
            {t("adminUsers.next")}
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to={pageUrl(query, page + 1)}>{t("adminUsers.next")}</Link>
          </Button>
        )}
      </div>
    </PageShell>
  );
}
