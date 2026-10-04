import { CheckCircle2, CircleAlert, Globe2, LoaderCircle, Server } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Form, useFetcher, useRevalidator } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { MotionPresence, MotionSwap } from "~/components/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

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
    <span className="text-muted-foreground">Enter the apex domain without a path.</span>
  );

  if (checking) {
    inspectionStateKey = "checking";
    inspectionStatus = (
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Checking DNS and HTTPS…
      </span>
    );
  } else if (inspectError) {
    inspectionStateKey = "error";
    inspectionStatus = <span className="text-destructive">{inspectError}</span>;
  } else if (displayedInspection && inspectionReady) {
    inspectionStateKey = "ready";
    inspectionStatus = (
      <span className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4" /> {displayedInspection.hostname} is ready to connect.
      </span>
    );
  } else if (displayedInspection) {
    inspectionStateKey = "unsafe";
    inspectionStatus = (
      <span className="inline-flex items-center gap-2 text-destructive">
        <CircleAlert className="size-4" /> We couldn’t safely verify this domain. Check its DNS and
        try again.
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-xl">Add Domain</DialogTitle>
          <DialogDescription>
            We check the current DNS and website before choosing the safest delivery mode.
          </DialogDescription>
        </DialogHeader>
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
                <MotionSwap
                  stateKey={inspectionStateKey}
                  distance={4}
                  enterDuration={180}
                  exitDuration={120}
                  reducedDuration={120}
                  reducedOpacity={0.85}
                >
                  {inspectionStatus}
                </MotionSwap>
              </div>
            </div>

            {organizers.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="connect-domain-chapter">Chapter</Label>
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
              </div>
            ) : null}

            <MotionPresence
              present={displayedInspection !== null && inspectionReady}
              distance={4}
              enterDuration={180}
              exitDuration={120}
              reducedDuration={120}
              reducedOpacity={0.85}
            >
              {displayedInspection && inspectionReady ? (
                <div className="rounded-xl border bg-muted/35 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full border bg-background p-2">
                      {displayedInspection.existingSite ? (
                        <Server className="size-4" />
                      ) : (
                        <Globe2 className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">
                        {displayedInspection.existingSite
                          ? "Existing website detected"
                          : "Short-link-only domain"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {displayedInspection.existingSite
                          ? `We’ll preserve the site first and use ${displayedInspection.suggestedUpstreamOrigin} as its private origin.`
                          : "No current HTTPS website was found, so every path will be handled as a short link."}
                      </p>
                      {displayedInspection.existingSite ? (
                        <p className="mt-3 border-t pt-3 text-sm">
                          After adding the domain, connect{" "}
                          <code>origin.{displayedInspection.hostname}</code> to the existing hosting
                          project. The domain stays Invalid until that origin and the gateway DNS
                          records are ready.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </MotionPresence>

            {createError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {createError}
              </p>
            ) : null}
          </div>
          <div className="border-t bg-muted/20 px-6 py-5">
            <Button
              type="submit"
              className="h-11 w-full bg-foreground text-background hover:bg-foreground/90"
              disabled={!canCreate || creator.state !== "idle"}
            >
              {creator.state !== "idle" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Add domain
            </Button>
          </div>
        </creator.Form>
      </DialogContent>
    </Dialog>
  );
}
