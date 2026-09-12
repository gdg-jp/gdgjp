import type { AuthUser } from "@gdgjp/gdg-lib";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  FormField,
  Heading,
  Icons,
  Input,
  Stack,
  Table,
  Text,
} from "@gdgjp/ui";
import { toast } from "@gdgjp/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
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
      if (fetcher.data.intent === "promote") toast.success(t("adminUsers.toast.promoted"));
      else if (fetcher.data.intent === "demote") toast.success(t("adminUsers.toast.demoted"));
      else if (fetcher.data.intent === "revoke") toast.success(t("adminUsers.toast.revoked"));
      else if (fetcher.data.intent === "chapter") toast.success(t("adminUsers.toast.chapter"));
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
        <DialogContent closeLabel={t("common.close")}>
          <Stack className="gap-2">
            <DialogTitle>
              {t("adminUsers.dialog.changeChapterTitle", { name: displayName })}
            </DialogTitle>
            <DialogDescription>{t("adminUsers.dialog.changeChapterDescription")}</DialogDescription>
          </Stack>
          <fetcher.Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="set-chapter" />
            <input type="hidden" name="userId" value={item.id} />
            {selectedChapterIds.map((chapterId) => (
              <input key={chapterId} type="hidden" name="chapterIds" value={chapterId} />
            ))}
            <div className="space-y-3">
              <div>
                <Text size="sm">{t("adminUsers.chapterLabel")}</Text>
                <Text size="sm" tone="muted">
                  {t("adminUsers.chapterHelp")}
                </Text>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedChapters.length === 0 ? (
                  <Text size="sm" tone="muted">
                    {t("adminUsers.chapterSelectedEmpty")}
                  </Text>
                ) : (
                  selectedChapters.map((chapter) => (
                    <Button
                      key={chapter.id}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => toggleChapter(chapter.id)}
                    >
                      {chapter.name}
                      <Icons name="X" size={14} aria-hidden="true" />
                      <span className="sr-only">
                        {t("adminUsers.removeChapter", { name: chapter.name })}
                      </span>
                    </Button>
                  ))
                )}
              </div>
              <FormField
                id="chapter-search"
                label={t("adminUsers.chapterSearchPlaceholder")}
                hideLabel
                className="gap-0"
              >
                <Input
                  type="search"
                  value={chapterQuery}
                  onChange={(event) => setChapterQuery(event.target.value)}
                  placeholder={t("adminUsers.chapterSearchPlaceholder")}
                  className="w-full"
                />
              </FormField>
              <div className="max-h-52 overflow-y-auto rounded-md border p-1">
                {chapterResults.length === 0 ? (
                  <Text size="sm" tone="muted" className="p-3">
                    {t("adminUsers.chapterNoMatches")}
                  </Text>
                ) : (
                  chapterResults.map((chapter) => {
                    const selected = selectedChapterIds.includes(chapter.id);
                    return (
                      <Button
                        key={chapter.id}
                        type="button"
                        variant="ghost"
                        fullWidth
                        className="justify-start"
                        onClick={() => toggleChapter(chapter.id)}
                      >
                        <span className="flex size-4 items-center justify-center">
                          {selected ? <Icons name="Check" size={16} aria-hidden="true" /> : null}
                        </span>
                        {chapter.name}
                        <span className="ml-auto font-mono text-xs text-muted">{chapter.slug}</span>
                      </Button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  {t("adminUsers.dialog.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" loading={busy}>
                {t("adminUsers.changeChapter")}
              </Button>
            </div>
          </fetcher.Form>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={busy || isSelf}>
            {item.isAdmin ? (
              <Icons name="ShieldCheck" size={16} aria-hidden="true" />
            ) : (
              <Icons name="UserRoundCheck" size={16} aria-hidden="true" />
            )}
            {item.isAdmin ? t("adminUsers.demote") : t("adminUsers.promote")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <Stack className="gap-2">
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
          </Stack>
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                {t("adminUsers.dialog.cancel")}
              </Button>
            </AlertDialogCancel>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="set-admin" />
              <input type="hidden" name="userId" value={item.id} />
              <input type="hidden" name="isAdmin" value={item.isAdmin ? "false" : "true"} />
              <AlertDialogAction asChild>
                <Button type="submit" loading={busy}>
                  {item.isAdmin ? t("adminUsers.demote") : t("adminUsers.promote")}
                </Button>
              </AlertDialogAction>
            </fetcher.Form>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={busy || isSelf}>
            <Icons name="Key" size={16} aria-hidden="true" />
            {t("adminUsers.revoke")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <Stack className="gap-2">
            <AlertDialogTitle>
              {t("adminUsers.dialog.revokeTitle", { name: displayName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminUsers.dialog.revokeDescription")}
            </AlertDialogDescription>
          </Stack>
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                {t("adminUsers.dialog.cancel")}
              </Button>
            </AlertDialogCancel>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="revoke-sessions" />
              <input type="hidden" name="userId" value={item.id} />
              <AlertDialogAction asChild>
                <Button type="submit" variant="danger" loading={busy}>
                  {t("adminUsers.revoke")}
                </Button>
              </AlertDialogAction>
            </fetcher.Form>
          </div>
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
        <FormField
          id="admin-users-search"
          label={t("adminUsers.searchPlaceholder")}
          hideLabel
          className="flex-1 gap-0"
        >
          <div className="relative">
            <Icons
              name="Search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("adminUsers.searchPlaceholder")}
              className="w-full pl-9"
            />
          </div>
        </FormField>
        <Button type="submit">{t("adminUsers.search")}</Button>
        {query ? (
          <Button asChild variant="outline">
            <Link to="/admin/users">{t("adminUsers.clear")}</Link>
          </Button>
        ) : null}
      </Form>

      <Text size="sm" tone="muted" className="mt-4 flex items-center justify-between">
        <span>{t("adminUsers.resultCount", { count: total })}</span>
        <span>{t("adminUsers.page", { page, pages })}</span>
      </Text>

      <Card className="mt-3 overflow-hidden p-0">
        {users.length === 0 ? (
          <EmptyState title={t("adminUsers.empty")} />
        ) : (
          <>
            <ul className="divide-y md:hidden">
              {users.map((item) => (
                <li key={item.id} className="space-y-4 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={item.image ?? undefined}
                      alt={item.name || item.email}
                      fallback={initials(item.name, item.email)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.name || item.email}</div>
                      <div className="truncate text-xs text-muted">{item.email}</div>
                    </div>
                    <Badge tone={item.isAdmin ? "success" : "neutral"}>
                      {item.isAdmin ? t("adminUsers.adminBadge") : t("adminUsers.userBadge")}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted">{t("adminUsers.table.memberships")}</dt>
                      <dd className="mt-1">
                        {t("adminUsers.activeMemberships", {
                          active: item.activeMembershipCount,
                          total: item.membershipCount,
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{t("adminUsers.table.sessions")}</dt>
                      <dd className="mt-1 tabular-nums">{item.sessionCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{t("adminUsers.table.created")}</dt>
                      <dd className="mt-1">{formatCreatedAt(item.createdAt, locale)}</dd>
                    </div>
                  </dl>
                  <UserActions item={item} actorId={user.id} chapters={chapters} />
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table scrollLabel={t("common.tableScroll")}>
                <thead>
                  <tr>
                    <th>{t("adminUsers.table.user")}</th>
                    <th>{t("adminUsers.table.memberships")}</th>
                    <th>{t("adminUsers.table.sessions")}</th>
                    <th>{t("adminUsers.table.created")}</th>
                    <th>{t("adminUsers.table.role")}</th>
                    <th className="text-right">{t("adminUsers.table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="flex min-w-56 items-center gap-3">
                          <Avatar
                            src={item.image ?? undefined}
                            alt={item.name || item.email}
                            fallback={initials(item.name, item.email)}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{item.name || item.email}</div>
                            <div className="truncate text-xs text-muted">{item.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-sm text-muted">
                        {t("adminUsers.activeMemberships", {
                          active: item.activeMembershipCount,
                          total: item.membershipCount,
                        })}
                      </td>
                      <td className="tabular-nums">{item.sessionCount}</td>
                      <td className="whitespace-nowrap text-sm text-muted">
                        {formatCreatedAt(item.createdAt, locale)}
                      </td>
                      <td>
                        <Badge tone={item.isAdmin ? "success" : "neutral"}>
                          {item.isAdmin ? t("adminUsers.adminBadge") : t("adminUsers.userBadge")}
                        </Badge>
                      </td>
                      <td>
                        <UserActions item={item} actorId={user.id} chapters={chapters} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
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
