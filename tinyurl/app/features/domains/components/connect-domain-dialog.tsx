import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Form, useFetcher, useRevalidator } from "react-router";
import type { DomainDetection } from "~/features/domains/domain-detection";
import type { action } from "~/features/domains/page.server";

export type Organizer = { chapterId: number; chapterSlug: string };

export function ConnectDomainDialog({
  open,
  onOpenChange,
  organizers,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizers: Organizer[];
  disabled: boolean;
}) {
  const inspector = useFetcher<typeof action>();
  const creator = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [hostname, setHostname] = useState("");
  const [requestedHostname, setRequestedHostname] = useState("");
  const [chapterId, setChapterId] = useState(String(organizers[0]?.chapterId ?? ""));
  const inspectSubmit = inspector.submit;

  useEffect(() => {
    if (!open || hostname.trim().length < 4) return;
    const timer = window.setTimeout(() => {
      setRequestedHostname(hostname.trim().toLowerCase().replace(/\.$/, ""));
      inspectSubmit({ intent: "inspect", hostname }, { method: "post" });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hostname, inspectSubmit, open]);

  useEffect(() => {
    if (creator.state !== "idle" || !creator.data || !("ok" in creator.data)) return;
    onOpenChange(false);
    setHostname("");
    revalidator.revalidate();
  }, [creator.data, creator.state, onOpenChange, revalidator]);

  const inspection: DomainDetection | null =
    inspector.data && "inspection" in inspector.data ? (inspector.data.inspection ?? null) : null;
  const currentHostname = hostname.trim().toLowerCase().replace(/\.$/, "");
  const displayedInspection = inspection?.hostname === currentHostname ? inspection : null;
  const inspectError =
    requestedHostname === currentHostname && inspector.data && "error" in inspector.data
      ? String(inspector.data.error)
      : null;
  const createError = creator.data && "error" in creator.data ? String(creator.data.error) : null;
  const checking = inspector.state !== "idle";
  const inspectionReady =
    displayedInspection !== null &&
    displayedInspection.dns.status !== "unsafe" &&
    displayedInspection.dns.status !== "error" &&
    displayedInspection.https.status !== "unsafe-redirect";
  const canCreate = inspectionReady && !disabled;
  let inspectionStateKey = "hint";
  let inspectionStatus: ReactNode = (
    <span className="text-muted">Enter the apex domain without a path.</span>
  );

  if (checking) {
    inspectionStateKey = "checking";
    inspectionStatus = (
      <span className="inline-flex items-center gap-2 text-muted">
        <Icons name="LoaderCircle" aria-hidden="true" className="size-4 animate-spin" /> Checking
        DNS and HTTPS…
      </span>
    );
  } else if (inspectError) {
    inspectionStateKey = "error";
    inspectionStatus = <span className="text-danger">{inspectError}</span>;
  } else if (displayedInspection && inspectionReady) {
    inspectionStateKey = "ready";
    inspectionStatus = (
      <span className="inline-flex items-center gap-2 text-success">
        <Icons name="CheckCircle2" aria-hidden="true" className="size-4" />{" "}
        {displayedInspection.hostname} is ready to connect.
      </span>
    );
  } else if (displayedInspection) {
    inspectionStateKey = "unsafe";
    inspectionStatus = (
      <span className="inline-flex items-center gap-2 text-danger">
        <Icons name="AlertCircle" aria-hidden="true" className="size-4" /> We couldn’t safely verify
        this domain. Check its DNS and try again.
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden sm:max-w-2xl">
        <div className="border-b px-6 py-5">
          <DialogTitle className="text-xl">Add Domain</DialogTitle>
          <DialogDescription>
            We check the current DNS and website before choosing the safest delivery mode.
          </DialogDescription>
        </div>
        <creator.Form method="post">
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="chapterId" value={chapterId} />
          <div className="space-y-5 px-6 py-6">
            <div className="space-y-2">
              <Label htmlFor="connect-domain">Your domain</Label>
              <Input
                id="connect-domain"
                name="hostname"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder="gdg-tokyo.jp"
                autoComplete="off"
                aria-describedby="domain-check-result"
                required
                autoFocus
              />
              <div id="domain-check-result" aria-live="polite" className="min-h-6 text-sm">
                <div>{inspectionStatus}</div>
              </div>
            </div>

            {organizers.length > 1 ? (
              <FormField id="connect-domain-chapter" label={<>Chapter</>}>
                <Select value={chapterId} onValueChange={setChapterId}>
                  <SelectTrigger id="connect-domain-chapter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {organizers.map((chapter) => (
                      <SelectItem key={chapter.chapterId} value={String(chapter.chapterId)}>
                        {chapter.chapterSlug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}

            {displayedInspection !== null && inspectionReady ? (
              <div>
                {displayedInspection && inspectionReady ? (
                  <div className="rounded-xl border bg-surface/35 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-full border bg-background p-2">
                        {displayedInspection.existingSite ? (
                          <Icons name="Database" aria-hidden="true" className="size-4" />
                        ) : (
                          <Icons name="Globe2" aria-hidden="true" className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium">
                          {displayedInspection.existingSite
                            ? "Existing website detected"
                            : "Short-link-only domain"}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {displayedInspection.existingSite
                            ? `We’ll preserve the site first and use ${displayedInspection.suggestedUpstreamOrigin} as its private origin.`
                            : "No current HTTPS website was found, so every path will be handled as a short link."}
                        </p>
                        {displayedInspection.existingSite ? (
                          <p className="mt-3 border-t pt-3 text-sm">
                            After adding the domain, connect{" "}
                            <code>origin.{displayedInspection.hostname}</code> to the existing
                            hosting project. The domain stays Invalid until that origin and the
                            gateway DNS records are ready.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {createError ? (
              <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {createError}
              </p>
            ) : null}
          </div>
          <div className="border-t bg-surface/20 px-6 py-5">
            <Button
              fullWidth
              type="submit"
              className="h-11  bg-foreground text-background hover:bg-foreground/90"
              disabled={!canCreate || creator.state !== "idle"}
            >
              {creator.state !== "idle" ? (
                <Icons name="LoaderCircle" aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              Add domain
            </Button>
          </div>
        </creator.Form>
      </DialogContent>
    </Dialog>
  );
}
