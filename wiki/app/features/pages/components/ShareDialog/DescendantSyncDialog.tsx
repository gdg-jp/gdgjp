import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import type { ShareDialogController } from "./use-share-dialog";

/** Prompt to propagate an ACL change to a page's descendants, shown after close. */
export function DescendantSyncDialog({ c }: { c: ShareDialogController }) {
  const {
    t,
    showDescendantDialog,
    setShowDescendantDialog,
    descendantCount,
    syncedDescendantCount,
    hasUnsyncedDescendants,
    includeUnsyncedDescendants,
    setIncludeUnsyncedDescendants,
    descendantFetcher,
    descendantRequestCompleted,
    canSyncDescendants,
    syncDescendants,
  } = c;

  return (
    <AlertDialog open={showDescendantDialog} onOpenChange={setShowDescendantDialog}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-2xl bg-card p-0 text-card-foreground shadow-2xl shadow-content-primary/20 sm:max-w-lg">
        <AlertDialogHeader className="gap-2 border-b border-border px-5 py-5 text-left sm:place-items-start sm:px-6">
          <AlertDialogTitle className="text-xl font-semibold tracking-[-0.01em]">
            {t("wiki.share_sync_descendants_title")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-base leading-relaxed">
            {t("wiki.share_sync_descendants_description", {
              count: descendantCount,
              syncedCount: syncedDescendantCount,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 px-5 py-5 sm:px-6">
          {hasUnsyncedDescendants && (
            <label className="flex min-h-10 items-center gap-2 text-sm text-card-foreground">
              <input
                type="checkbox"
                checked={includeUnsyncedDescendants}
                onChange={(event) => setIncludeUnsyncedDescendants(event.target.checked)}
                disabled={descendantFetcher.state !== "idle" || descendantRequestCompleted}
                className="h-5 w-5 accent-primary"
              />
              {t("wiki.share_sync_descendants_include_unsynced")}
            </label>
          )}
          {syncedDescendantCount === 0 && !includeUnsyncedDescendants && (
            <p className="rounded-xl bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
              {t("wiki.share_sync_descendants_none")}
            </p>
          )}
          {descendantRequestCompleted && descendantFetcher.data?.ok && (
            <output className="block rounded-xl bg-feedback-success-surface px-4 py-3 text-sm leading-relaxed text-feedback-success-foreground">
              {t("wiki.share_sync_descendants_result", {
                updated: descendantFetcher.data.updatedCount ?? 0,
                unsynced: descendantFetcher.data.unsyncedSkippedCount ?? 0,
                forbidden: descendantFetcher.data.permissionSkippedCount ?? 0,
              })}
            </output>
          )}
          {descendantRequestCompleted && descendantFetcher.data?.error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {t("wiki.share_error_generic")}
            </p>
          )}
        </div>
        <AlertDialogFooter className="border-t border-border bg-muted/30 px-5 py-4 sm:px-6">
          <Button
            variant="ghost"
            onClick={() => setShowDescendantDialog(false)}
            disabled={descendantFetcher.state !== "idle"}
          >
            {descendantRequestCompleted && descendantFetcher.data?.ok
              ? t("close")
              : t("wiki.share_not_now")}
          </Button>
          {(!descendantRequestCompleted || !descendantFetcher.data?.ok) && canSyncDescendants && (
            <Button
              onClick={syncDescendants}
              disabled={descendantFetcher.state !== "idle"}
              className="rounded-full px-5"
            >
              {descendantFetcher.state !== "idle" && (
                <Loader2 className="animate-spin motion-reduce:animate-none" size={16} />
              )}
              {t(
                includeUnsyncedDescendants
                  ? "wiki.share_sync_descendants_action_all"
                  : "wiki.share_sync_descendants_action",
              )}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
