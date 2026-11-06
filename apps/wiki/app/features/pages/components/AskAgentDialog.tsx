import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Textarea,
} from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

/**
 * Agent pages are read-only for people; this is how they get changed. The request is added
 * to the space's next synthesize job and the requester is notified when it was handled.
 */
export function AskAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [text, setText] = useState("");
  const sent = fetcher.state === "idle" && fetcher.data?.ok === true;

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-lg">
        <div className="flex flex-col gap-3 p-5">
          <DialogTitle>{t("wiki.ask_agent_title")}</DialogTitle>
          <DialogDescription>{t("wiki.ask_agent_description")}</DialogDescription>
          {sent ? (
            <output className="block text-sm text-foreground">{t("wiki.ask_agent_sent")}</output>
          ) : (
            <fetcher.Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="askAgent" />
              <FormField label={t("wiki.ask_agent_label")} required>
                <Textarea
                  name="text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={2000}
                  rows={5}
                  required
                />
              </FormField>
              {fetcher.data?.error ? (
                <p role="alert" className="text-sm text-danger">
                  {t("wiki.ask_agent_error")}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={!text.trim()} loading={fetcher.state !== "idle"}>
                  {t("wiki.ask_agent_submit")}
                </Button>
              </div>
            </fetcher.Form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
