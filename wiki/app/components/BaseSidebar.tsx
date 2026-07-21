import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";

export const COLLAPSE_THRESHOLD = 120;
export const DEFAULT_WIDTH = 240;
export const MIN_WIDTH = 48;
export const MAX_WIDTH = 400;

interface BaseSidebarProps {
  storageKey: string;
  isOpen: boolean;
  isMobile: boolean;
  onClose?: () => void;
  children: (props: { isCollapsed: boolean }) => React.ReactNode;
}

export default function BaseSidebar({
  storageKey,
  isOpen,
  isMobile,
  onClose,
  children,
}: BaseSidebarProps) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = localStorage.getItem(storageKey);
    return stored ? Number(stored) : DEFAULT_WIDTH;
  });

  const isDragging = useRef(false);
  const mobileTriggerRef = useRef<HTMLElement | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [isResizing, setIsResizing] = useState(false);
  const isCollapsed = isMobile ? false : width < COLLAPSE_THRESHOLD;
  const sidebarTransition = isResizing
    ? "none"
    : "transform var(--motion-duration-enter) var(--motion-ease-out)";

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const delta = e.clientX - startX.current;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
    setWidth(newWidth);
  }, []);

  const onMouseUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setWidth((w) => {
      localStorage.setItem(storageKey, String(w));
      return w;
    });
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }, [storageKey, onMouseMove]);

  const onDragHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsResizing(true);
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [width, onMouseMove, onMouseUp],
  );

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(nextOpen) => !nextOpen && onClose?.()}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          overlayClassName="top-14"
          className="bottom-0 top-14 w-64 bg-card text-card-foreground"
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
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {children({ isCollapsed: false })}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      {/* Sidebar */}
      <aside
        style={{
          width,
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: sidebarTransition,
        }}
        className="desktop-sidebar fixed bottom-0 left-0 top-14 overflow-hidden border-r border-gray-200 bg-white"
      >
        {children({ isCollapsed })}

        {/* Drag handle */}
        {isOpen && (
          <div
            onMouseDown={onDragHandleMouseDown}
            className="absolute bottom-0 right-0 top-0 w-1 cursor-col-resize hover:bg-blue-200/50 active:bg-blue-300/50"
            aria-hidden="true"
          />
        )}
      </aside>

      {/* Spacer for main content */}
      <div style={{ width: isOpen ? width : 0 }} className="flex-shrink-0" />
    </>
  );
}
