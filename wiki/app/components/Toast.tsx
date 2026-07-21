import { CheckCircle2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { MotionPresence } from "~/components/ui/motion";

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

export default function Toast({ message, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);

  const dismiss = useCallback(() => {
    setVisible(false);
    window.setTimeout(onDismiss, 140);
  }, [onDismiss]);

  useEffect(() => {
    const timer = window.setTimeout(dismiss, 4000);
    return () => window.clearTimeout(timer);
  }, [dismiss]);

  return (
    <MotionPresence
      present={visible}
      distance={-8}
      className="fixed right-4 top-16 z-50 max-w-[calc(100vw-2rem)]"
    >
      <output
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border border-green-500/25 bg-card px-4 py-3 text-card-foreground shadow-xl shadow-black/15"
      >
        <CheckCircle2 className="size-5 shrink-0 text-green-600" />
        <span className="text-sm font-medium">{message}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          className="-mr-2 rounded-full text-muted-foreground"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </Button>
      </output>
    </MotionPresence>
  );
}
