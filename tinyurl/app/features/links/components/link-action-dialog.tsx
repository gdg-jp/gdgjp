import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";

export type LinkAction = "archive" | "restore" | "delete";

export function LinkActionDialog({
  action,
  linkId,
  linkSlug,
  destinationUrl,
  open,
  onOpenChange,
}: {
  action: LinkAction;
  linkId: string;
  linkSlug: string;
  destinationUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const pending = fetcher.state !== "idle" && fetcher.formData?.get("intent") === action;
  const isArchive = action === "archive";
  const isRestore = action === "restore";
  const isNonDestructive = isArchive || isRestore;
  const [confirmation, setConfirmation] = useState("");
  const deleteConfirmed = confirmation === linkSlug;

  useEffect(() => {
    if (open) setConfirmation("");
  }, [open]);

  let favicon: string | null = null;
  try {
    favicon = `https://www.google.com/s2/favicons?domain=${new URL(destinationUrl).hostname}&sz=64`;
  } catch {
    // The destination URL is validated when a link is created or edited.
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-0 overflow-hidden p-0 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start border-b px-5 py-4 text-left">
          <AlertDialogTitle className="text-base">
            {isArchive ? "Archive link" : isRestore ? "Restore link" : "Delete link"}
          </AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-4 px-5 py-5">
          <AlertDialogDescription className="text-sm text-foreground">
            Are you sure you want to {action} the following link?
          </AlertDialogDescription>

          {!isNonDestructive ? (
            <p className="text-sm font-semibold leading-relaxed text-foreground">
              Deleting these links will remove all of their analytics. This action cannot be undone
              – proceed with caution.
            </p>
          ) : null}

          <LinkPreview favicon={favicon} linkSlug={linkSlug} destinationUrl={destinationUrl} />

          {!isNonDestructive ? (
            <div className="space-y-2 pt-1">
              <p id={`delete-confirmation-instructions-${linkId}`} className="select-text text-sm">
                To verify, type <strong>{linkSlug}</strong> below
              </p>
              <Input
                id={`delete-confirmation-${linkId}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                autoFocus
                aria-label="Confirm link deletion"
                aria-describedby={`delete-confirmation-instructions-${linkId}`}
              />
            </div>
          ) : null}

          {fetcher.data?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {fetcher.data.error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter className="border-t bg-muted/20 px-5 py-3">
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <fetcher.Form method="post" action={`/links/${linkId}`}>
            <input type="hidden" name="intent" value={action} />
            <Button
              type="submit"
              variant={isNonDestructive ? "default" : "destructive"}
              className={
                isNonDestructive
                  ? "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
                  : ""
              }
              disabled={pending || (!isNonDestructive && !deleteConfirmed)}
              aria-busy={pending || undefined}
            >
              {pending ? (
                <Spinner
                  size="sm"
                  label={isArchive ? "Archiving" : isRestore ? "Restoring" : "Deleting"}
                />
              ) : null}
              {isArchive ? "Archive link" : isRestore ? "Restore link" : "Delete link"}
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LinkPreview({
  favicon,
  linkSlug,
  destinationUrl,
}: {
  favicon: string | null;
  linkSlug: string;
  destinationUrl: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-2">
      <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background">
          {favicon ? (
            <img
              src={favicon}
              alt=""
              width={18}
              height={18}
              className="size-4.5 rounded-sm"
              referrerPolicy="no-referrer"
            />
          ) : (
            <ExternalLink className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{linkSlug}</p>
          <p className="truncate text-sm text-muted-foreground">↳ {destinationUrl}</p>
        </div>
      </div>
    </div>
  );
}
