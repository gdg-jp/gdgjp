import { useEventListener } from "@gdgjp/gdg-lib/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SidebarPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}

type PopoverPosition = { top: number; left: number; originY: number };

export default function SidebarPopover({
  open,
  onClose,
  anchorRef,
  children,
}: SidebarPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - 400));
    const left = rect.right + 8;
    const originY = Math.max(0, Math.min(400, rect.top + rect.height / 2 - top));
    setPos({ top, left, originY });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) return;

    let frame = 0;
    function schedulePositionUpdate() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    }

    schedulePositionUpdate();
    window.addEventListener("scroll", schedulePositionUpdate, true);
    window.addEventListener("resize", schedulePositionUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      window.removeEventListener("resize", schedulePositionUpdate);
    };
  }, [open, updatePosition]);

  useEventListener("document", "keydown", (e) => {
    if (open && e.key === "Escape") onClose();
  });

  useEventListener("document", "mousedown", (e) => {
    if (!open) return;
    const target = e.target as Node;
    if (panelRef.current?.contains(target)) return;
    if (anchorRef.current?.contains(target)) return;
    onClose();
  });

  if (!open || !pos) return null;

  return createPortal(
    <div className="fixed z-50" style={{ top: pos.top, left: pos.left }}>
      <div ref={panelRef} className="w-80 bg-surface">
        {children}
      </div>
    </div>,
    document.body,
  );
}
