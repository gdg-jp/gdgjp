import { useRef } from "react";

interface SidebarDialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function SidebarDialog({ open, onClose, children }: SidebarDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") onClose();
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      open
      onClick={handleBackdropClick}
      onKeyDown={handleDialogKeyDown}
      className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center bg-black/40 p-0"
      style={{ maxWidth: "none", maxHeight: "none" }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation from inner panel */}
      <div
        className="relative w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </dialog>
  );
}
