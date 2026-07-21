import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MotionPresence } from "~/components/ui/motion";

interface SidebarPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}

export default function SidebarPopover({
  open,
  onClose,
  anchorRef,
  children,
}: SidebarPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Track anchor position with rAF while open
  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - 400));
    const left = rect.right + 8;
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) return;

    let rafId: number;
    function loop() {
      updatePosition();
      rafId = requestAnimationFrame(loop);
    }
    loop();

    return () => cancelAnimationFrame(rafId);
  }, [open, updatePosition]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Close on click outside (excluding popover panel and anchor button)
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div className="fixed z-50" style={{ top: pos.top, left: pos.left }}>
      <MotionPresence
        present={open}
        axis="x"
        distance={-4}
        scale={0.98}
        transformOrigin="left center"
        enterDuration={200}
        exitDuration={140}
        reducedOpacity={0.85}
        className="w-80"
      >
        <div ref={panelRef} className="rounded-xl bg-white shadow-xl">
          {children}
        </div>
      </MotionPresence>
    </div>,
    document.body,
  );
}
