import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  IconButton,
  Icons,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  toast,
} from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import type { RouteData } from "~/lib/route-data";
import type { actOnInvites, loadInvites } from "../invites.server";
import { DEFAULT_INVITE_EXPIRY_DAYS, INVITE_EXPIRY_DAYS } from "../types";

type LoaderData = RouteData<typeof loadInvites>;
type InviteRow = LoaderData["invites"][number];

function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <FormField id={id} label={label} hideLabel>
      <div className="flex gap-2">
        <Input readOnly value={value} className="min-w-0 flex-1 font-mono text-xs" />
        <IconButton variant="outline" onClick={copy} aria-label={t("invites.copy")}>
          <Icons name={copied ? "Check" : "Copy"} size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </FormField>
  );
}

export function InviteCreateForm({
  chapters,
  preselectedChapterId,
}: Pick<LoaderData, "chapters" | "preselectedChapterId">) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnInvites>();
  const result = fetcher.data;
  const createdUrl = result && "url" in result ? result.url : null;

  useEffect(() => {
    if (fetcher.state !== "idle" || !result || !("error" in result)) return;
    toast.error(result.error);
  }, [fetcher.state, result]);

  return (
    <Card>
      <Stack>
        <Heading level={2} id="invite-create-heading">
          {t("invites.create.title")}
        </Heading>
        <Text tone="muted">{t("invites.create.description")}</Text>
      </Stack>
      <fetcher.Form method="post" className="mt-6 space-y-6">
        <input type="hidden" name="intent" value="create" />
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{t("invites.create.chapters")}</legend>
          <div className="divide-y border-y">
            {chapters.map((chapter) => (
              <label
                key={chapter.id}
                htmlFor={`invite-chapter-${chapter.id}`}
                className="flex cursor-pointer items-center gap-3 py-3"
              >
                <Checkbox
                  id={`invite-chapter-${chapter.id}`}
                  name="chapterId"
                  value={String(chapter.id)}
                  defaultChecked={chapters.length === 1 || chapter.id === preselectedChapterId}
                />
                <span className="text-sm font-medium">{chapter.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <FormField id="invite-expiry" label={t("invites.create.expiry")} className="max-w-xs">
          <Select name="expiresInDays" defaultValue={String(DEFAULT_INVITE_EXPIRY_DAYS)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVITE_EXPIRY_DAYS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {t("invites.create.days", { count: days })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <Button type="submit" loading={fetcher.state !== "idle"}>
          <Icons name="Link" size={16} aria-hidden="true" />
          {t("invites.create.submit")}
        </Button>
      </fetcher.Form>
      {createdUrl ? (
        <Alert tone="success" title={t("invites.create.created")} className="mt-6">
          <CopyField id="invite-created-url" label={t("invites.url")} value={createdUrl} />
        </Alert>
      ) : null}
    </Card>
  );
}

function RevokeInvite({ invite }: { invite: InviteRow }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnInvites>();
  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result || !("error" in result)) return;
    toast.error(result.error);
  }, [fetcher.state, fetcher.data]);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" loading={fetcher.state !== "idle"}>
          {t("invites.list.revoke")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Stack className="gap-2">
          <AlertDialogTitle>{t("invites.list.revokeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("invites.list.revokeDescription")}</AlertDialogDescription>
        </Stack>
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              {t("organize.dialog.cancel")}
            </Button>
          </AlertDialogCancel>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <AlertDialogAction asChild>
              <Button type="submit" variant="danger">
                {t("invites.list.revoke")}
              </Button>
            </AlertDialogAction>
          </fetcher.Form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function InviteList({ invites }: Pick<LoaderData, "invites">) {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  });
  return (
    <Card>
      <Stack>
        <Heading level={2} id="invite-list-heading">
          {t("invites.list.title", { count: invites.length })}
        </Heading>
        <Text tone="muted">{t("invites.list.description")}</Text>
      </Stack>
      {invites.length === 0 ? (
        <Text size="sm" tone="muted" className="mt-6">
          {t("invites.list.empty")}
        </Text>
      ) : (
        <ul className="mt-6 divide-y border-y">
          {invites.map((invite) => (
            <li key={invite.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <Text className="font-medium">
                    {invite.chapters.map((c) => c.name).join(", ")}
                  </Text>
                  <Text size="xs" tone="muted">
                    {t("invites.list.meta", {
                      expiresAt: format.format(new Date(invite.expiresAt * 1000)),
                      creator: invite.creator?.name || invite.creator?.email || "—",
                    })}
                  </Text>
                </div>
                {invite.canRevoke ? <RevokeInvite invite={invite} /> : null}
              </div>
              <CopyField
                id={`invite-url-${invite.id}`}
                label={t("invites.url")}
                value={invite.url}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
