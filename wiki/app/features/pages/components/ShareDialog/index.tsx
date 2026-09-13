import { IconButton } from "@gdgjp/ui";
import { Dialog, DialogContent, DialogTitle } from "@gdgjp/ui";

import { DescendantSyncDialog } from "./DescendantSyncDialog";
import { GrantScreen } from "./GrantScreen";
import { OverviewScreen } from "./OverviewScreen";
import { SearchCombobox } from "./SearchCombobox";
import type { ShareDialogProps } from "./types";
import { useShareDialog } from "./use-share-dialog";

/**
 * Page sharing dialog. State/effects/handlers live in `use-share-dialog.ts`;
 * screens are `SearchCombobox` + `OverviewScreen` / `GrantScreen`; the
 * post-close descendant-propagation prompt is `DescendantSyncDialog`.
 */
import { Icons } from "@gdgjp/ui";
export default function ShareDialog(props: ShareDialogProps) {
  const { open, pageTitle } = props;
  const c = useShareDialog(props);
  const {
    t,
    screen,
    setScreen,
    setIsListOpen,
    isMutating,
    canManage,
    close,
    handleEscapeKeyDown,
    restoreFocusRef,
  } = c;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isMutating) close();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusRef.current?.focus();
            restoreFocusRef.current = null;
          }}
          onEscapeKeyDown={handleEscapeKeyDown}
          onPointerDownOutside={(event) => {
            if (isMutating) event.preventDefault();
          }}
          className="share-dialog-content flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[37.5rem] flex-col gap-0 overflow-hidden rounded-2xl border-border bg-surface p-0 text-foreground shadow-2xl shadow-content-primary/20 sm:max-h-[calc(100dvh-3rem)] sm:max-w-[37.5rem]"
        >
          <header className="flex items-center gap-2 px-5 pb-3 pt-5 sm:px-6">
            {screen === "grant" && (
              <IconButton
                variant="ghost"
                onClick={() => {
                  setIsListOpen(false);
                  setScreen("overview");
                }}
                className="-ml-2 rounded-full"
                aria-label={t("wiki.share_back")}
              >
                <Icons name="ChevronLeft" size={22} />
              </IconButton>
            )}
            <DialogTitle className="min-w-0 flex-1 truncate text-xl font-medium tracking-[-0.01em]">
              {t("wiki.share_dialog_title", { title: pageTitle })}
            </DialogTitle>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
            {canManage ? <SearchCombobox c={c} /> : null}

            <div className="min-h-0">
              {screen === "grant" ? <GrantScreen c={c} /> : <OverviewScreen c={c} />}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <DescendantSyncDialog c={c} />
    </>
  );
}
