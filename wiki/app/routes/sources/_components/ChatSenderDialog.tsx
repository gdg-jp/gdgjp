import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { action } from "../page";

export function ChatSenderDialog({
  open,
  onOpenChange,
  profiles,
  samples,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Array<{ resourceName: string; displayName: string }>;
  samples: Array<{
    resourceName: string;
    messageText: string;
    sourceId: string;
    sourceTitle: string;
  }>;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.resourceName, profile])),
    [profiles],
  );
  const senderIds = useMemo(() => {
    const ids = [...new Set(samples.map((sample) => sample.resourceName))];
    return ids.sort((left, right) => {
      const leftLabel = profileById.get(left)?.displayName
        ? `${profileById.get(left)?.displayName} (${left})`
        : left;
      const rightLabel = profileById.get(right)?.displayName
        ? `${profileById.get(right)?.displayName} (${right})`
        : right;
      const leftMapped = profileById.has(left);
      const rightMapped = profileById.has(right);
      return leftMapped === rightMapped ? leftLabel.localeCompare(rightLabel) : leftMapped ? 1 : -1;
    });
  }, [profileById, samples]);
  const [senderId, setSenderId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectedSamples = samples.filter((sample) => sample.resourceName === senderId).slice(0, 10);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (!open) return;
    const first = senderIds[0] ?? "";
    setSenderId(first);
    setDisplayName(profileById.get(first)?.displayName ?? "");
    setExpanded({});
  }, [open, profileById, senderIds]);

  function selectSender(nextId: string) {
    setSenderId(nextId);
    setDisplayName(profileById.get(nextId)?.displayName ?? "");
    setExpanded({});
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface-raised sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("sources.sender_dialog_title")}</DialogTitle>
          <DialogDescription>{t("sources.sender_dialog_description")}</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="save-chat-sender" />
          <input type="hidden" name="senderId" value={senderId} />
          <div className="block text-sm font-medium text-content-secondary">
            <p>{t("sources.sender_id_label")}</p>
            <Select value={senderId} onValueChange={selectSender}>
              <SelectTrigger className="mt-1 w-full bg-surface-raised">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {senderIds.map((id) => {
                  const profile = profileById.get(id);
                  return (
                    <SelectItem key={id} value={id}>
                      {profile ? `${profile.displayName} (${id})` : id}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <label className="block text-sm font-medium text-content-secondary">
            {t("sources.sender_name_label")}
            <input
              name="displayName"
              required
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 block w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm"
            />
          </label>
          <section>
            <h3 className="text-sm font-medium text-content-secondary">
              {t("sources.sender_samples")}
            </h3>
            <ul className="mt-2 space-y-2">
              {selectedSamples.map((sample, index) => {
                const key = `${sample.sourceId}:${index}`;
                const isExpanded = expanded[key] ?? false;
                const preview =
                  sample.messageText.length > 160
                    ? `${sample.messageText.slice(0, 160)}…`
                    : sample.messageText;
                return (
                  <li key={key} className="rounded-md border border-border-default p-3 text-sm">
                    <p className="font-medium text-content-primary">{sample.sourceTitle}</p>
                    <p className="mt-1 whitespace-pre-wrap text-content-secondary">
                      {isExpanded
                        ? sample.messageText
                        : preview || t("sources.sender_empty_message")}
                    </p>
                    {sample.messageText.length > 160 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((current) => ({ ...current, [key]: !isExpanded }))
                        }
                        className="mt-2 text-xs font-medium text-action-primary hover:underline"
                      >
                        {t(isExpanded ? "sources.sender_collapse" : "sources.sender_expand")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
          {fetcher.data && !fetcher.data.ok ? (
            <p className="text-sm text-feedback-danger-foreground">
              {t(`sources.error_${fetcher.data.error}`, {
                defaultValue: t("sources.error_generic"),
              })}
            </p>
          ) : null}
          {fetcher.data?.ok && fetcher.data.senderSaved ? (
            <p className="text-sm text-feedback-success-foreground">{t("sources.sender_saved")}</p>
          ) : null}
          <DialogFooter className="px-0 py-0">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border-strong px-4 py-2 text-sm hover:bg-surface-hover"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !senderId || !displayName.trim()}
              className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-60"
            >
              {saving ? t("sources.sender_saving") : t("sources.sender_save")}
            </button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
