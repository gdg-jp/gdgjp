import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    /* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click handled via onClick; Escape handled by window keydown */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation from inner panel */}
      <dialog
        ref={dialogRef}
        open
        onClick={(e) => e.stopPropagation()}
        className="relative m-4 w-full max-w-sm rounded-xl bg-white p-0 shadow-xl"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="px-5 pb-5 pt-5">
          <h2 id="confirm-dialog-title" className="mb-2 text-base font-semibold text-gray-900">
            {title}
          </h2>
          <p className="text-sm text-gray-600">{message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium text-white",
              destructive ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700",
            ].join(" ")}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </div>
  );
}
