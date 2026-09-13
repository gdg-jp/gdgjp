import { Sheet, SheetContent, SheetDescription, SheetTitle, Sidebar as UiSidebar } from "@gdgjp/ui";
import { useRef } from "react";

interface BaseSidebarProps {
  isOpen: boolean;
  isMobile: boolean;
  onClose?: () => void;
  navigationDescription: string;
  children: (props: { isCollapsed: boolean }) => React.ReactNode;
}

/**
 * Wiki navigation uses the shared Sheet surface and a fixed-width desktop
 * sidebar. Width dragging is intentionally removed for the GDG Apps shell.
 */
export default function BaseSidebar({
  isOpen,
  isMobile,
  onClose,
  navigationDescription,
  children,
}: BaseSidebarProps) {
  const mobileTriggerRef = useRef<HTMLElement | null>(null);

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(nextOpen) => !nextOpen && onClose?.()}>
        <SheetContent
          side="left"
          className="bottom-0 top-14 w-60 bg-surface text-foreground"
          onOpenAutoFocus={() => {
            if (document.activeElement instanceof HTMLElement) {
              mobileTriggerRef.current = document.activeElement;
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            mobileTriggerRef.current?.focus();
          }}
        >
          <SheetTitle className="gdg-sr-only">Navigation</SheetTitle>
          <SheetDescription className="gdg-sr-only">{navigationDescription}</SheetDescription>
          {children({ isCollapsed: false })}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      <UiSidebar
        aria-hidden={!isOpen}
        collapsible="offcanvas"
        className="fixed bottom-0 left-0 top-14 h-[calc(100dvh-3.5rem)] min-h-0 p-0"
      >
        {children({ isCollapsed: false })}
      </UiSidebar>
      <div aria-hidden="true" className={`shrink-0 ${isOpen ? "w-60" : "w-0"}`} />
    </>
  );
}
