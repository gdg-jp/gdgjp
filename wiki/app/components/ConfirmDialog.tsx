import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Inline,
  Stack,
} from "@gdgjp/design-system";
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
  const closeIntent = useRef<"cancel" | "confirm" | null>(null);

  useEffect(() => {
    if (open) closeIntent.current = null;
  }, [open]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        if (closeIntent.current === null) onCancel();
        closeIntent.current = null;
      }}
    >
      <AlertDialogContent className="max-w-sm rounded-2xl shadow-2xl shadow-content-primary/20">
        <Stack>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </Stack>
        <Inline>
          <AlertDialogCancel
            onClick={() => {
              closeIntent.current = "cancel";
              onCancel();
            }}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <Button asChild variant={destructive ? "danger" : "primary"}>
            <AlertDialogAction
              onClick={() => {
                closeIntent.current = "confirm";
                onConfirm();
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </Button>
        </Inline>
      </AlertDialogContent>
    </AlertDialog>
  );
}
