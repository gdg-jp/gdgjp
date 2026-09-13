import { Sheet, SheetContent, SheetTitle } from "@gdgjp/ui";
import { useRef } from "react";

interface BaseSidebarProps {
  isOpen: boolean;
  isMobile: boolean;
  onClose?: () => void;
  children: (props: { isCollapsed: boolean }) => React.ReactNode;
}

/**
 * Wiki navigation uses the shared Sheet surface and a fixed-width desktop
 * sidebar. Width dragging is intentionally removed for the GDG Apps shell.
 */
export default function BaseSidebar({ isOpen, isMobile, onClose, children }: BaseSidebarProps) {
  const mobileTriggerRef = useRef<HTMLElement | null>(null);

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(nextOpen) => !nextOpen && onClose?.()}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
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
          {children({ isCollapsed: false })}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      <aside
        aria-hidden={!isOpen}
        className={`fixed bottom-0 left-0 top-14 w-60 overflow-hidden bg-surface transition-transform motion-reduce:transition-none ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {children({ isCollapsed: false })}
      </aside>
      <div aria-hidden="true" className={`shrink-0 ${isOpen ? "w-60" : "w-0"}`} />
    </>
  );
}
