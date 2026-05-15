import { useEffect } from "react";

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

export default function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed right-4 top-16 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg bg-green-500 px-4 py-3 text-white shadow-lg">
      <span className="text-sm font-medium">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-white/80 hover:text-white"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
