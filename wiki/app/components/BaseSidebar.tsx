import { useCallback, useEffect, useRef, useState } from "react";

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
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [isResizing, setIsResizing] = useState(false);
  const originalOverflowRef = useRef<string | null>(null);

  const isCollapsed = isMobile ? false : width < COLLAPSE_THRESHOLD;
  const displayWidth = isOpen ? width : 0;
  const transition = isResizing ? "none" : "width 200ms ease";

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

  // Escape key closes mobile drawer
  useEffect(() => {
    if (!isMobile || !isOpen || !onClose) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, isOpen, onClose]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (!isMobile) return;
    if (isOpen && originalOverflowRef.current === null) {
      originalOverflowRef.current = document.body.style.overflow;
    }
    document.body.style.overflow = isOpen ? "hidden" : (originalOverflowRef.current ?? "");
    return () => {
      document.body.style.overflow = originalOverflowRef.current ?? "";
      if (!isOpen) originalOverflowRef.current = null;
    };
  }, [isMobile, isOpen]);

  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        {isOpen && (
          /* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop closes via pointer; Escape handled by window keydown */
          <div
            className="fixed inset-0 top-14 z-30 bg-black/40"
            onClick={onClose}
            aria-hidden="true"
          />
        )}

        {/* Drawer */}
        {isOpen && (
          <aside className="fixed bottom-0 left-0 top-14 z-40 w-64 overflow-hidden border-r border-gray-200 bg-white">
            {children({ isCollapsed: false })}
          </aside>
        )}
      </>
    );
  }

  return (
    <>
      {/* Sidebar */}
      <aside
        style={{ width: displayWidth, transition }}
        className="fixed bottom-0 left-0 top-14 overflow-hidden border-r border-gray-200 bg-white"
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
      <div style={{ width: displayWidth, transition }} className="flex-shrink-0" />
    </>
  );
}
