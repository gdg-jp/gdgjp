import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
} from "@gdgjp/design-system";
import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from "react";

export type ConfirmCopy = {
  title: string;
  action: string;
  description?: string;
  danger?: boolean;
};

type Ask = (copy: ConfirmCopy) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm outside ConfirmProvider");
  return ask;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{
    id: number;
    copy: ConfirmCopy;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const seq = useRef(0);

  const ask = useCallback<Ask>(
    (copy) =>
      new Promise<boolean>((resolve) => {
        seq.current += 1;
        setDialog({ id: seq.current, copy, resolve });
      }),
    [],
  );

  const close = (ok: boolean) => {
    if (!dialog) return;
    const { id, resolve } = dialog;
    setDialog((current) => (current?.id === id ? null : current));
    resolve(ok);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <AlertDialog open={dialog !== null} onOpenChange={(open) => !open && close(false)}>
        <AlertDialogContent
          className="mc-confirm"
          {...(dialog?.copy.description ? {} : { "aria-describedby": undefined })}
        >
          <AlertDialogTitle>{dialog?.copy.title}</AlertDialogTitle>
          {dialog?.copy.description && (
            <AlertDialogDescription className="mc-confirm-warning">
              {dialog.copy.description}
            </AlertDialogDescription>
          )}
          <div className="mc-confirm-actions">
            <AlertDialogCancel asChild>
              <Button variant="outline" onClick={() => close(false)}>
                キャンセル
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant={dialog?.copy.danger ? "danger" : "primary"}
                onClick={() => close(true)}
              >
                {dialog?.copy.action}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
