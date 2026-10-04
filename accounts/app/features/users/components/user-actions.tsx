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
import { Form, Link, useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/layouts/page-shell";
import type { actOnUserAdmin, loadUserAdmin } from "../admin.server";
import { pageUrl } from "../page-url";
type LoaderData = Awaited<ReturnType<typeof loadUserAdmin>>;
type ManagedUser = LoaderData["users"][number];

export function UserActions({
  item,
  actorId,
  chapters,
}: {
  item: ManagedUser;
  actorId: string;
  chapters: LoaderData["chapters"];
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnUserAdmin>();
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
