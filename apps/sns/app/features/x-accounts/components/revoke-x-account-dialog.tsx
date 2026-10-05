import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useState } from "react";
import { Form } from "react-router";

export function RevokeXAccountDialog({
  accountId,
  xUserId,
}: { accountId: string; xUserId: string }) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === xUserId;

  return (
    <AlertDialogPrimitive.Root onOpenChange={(open) => !open && setConfirmation("")}>
      <AlertDialogPrimitive.Trigger asChild>
        <button type="button" className="text-sm text-red-500">
          解除
        </button>
      </AlertDialogPrimitive.Trigger>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-lg outline-none animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:zoom-in-95">
          <div className="grid gap-1.5 text-center sm:text-left">
            <AlertDialogPrimitive.Title className="text-lg font-semibold">
              Xアカウントの認可を解除しますか？
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
              この操作は取り消せません。解除するには、次のX Account IDを入力してください: {xUserId}
            </AlertDialogPrimitive.Description>
          </div>
          <Form method="post" action="/settings/x" className="grid gap-4">
            <input type="hidden" name="id" value={accountId} />
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="xUserId" value={confirmation} />
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor={`x-account-id-${accountId}`}
            >
              X Account ID
              <input
                id={`x-account-id-${accountId}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                className="rounded-xl border bg-card p-2 font-normal"
              />
            </label>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogPrimitive.Cancel asChild>
                <button
                  type="button"
                  className="rounded-full border px-5 py-2 font-bold hover:bg-muted"
                >
                  キャンセル
                </button>
              </AlertDialogPrimitive.Cancel>
              <AlertDialogPrimitive.Action asChild>
                <button
                  type="submit"
                  disabled={!confirmed}
                  className="rounded-full bg-destructive px-5 py-2 font-bold text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  削除する
                </button>
              </AlertDialogPrimitive.Action>
            </div>
          </Form>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
