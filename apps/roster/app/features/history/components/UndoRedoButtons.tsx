import { Form, useNavigation } from "react-router";

export function UndoRedoButtons({ canUndo, canRedo }: { canUndo: boolean; canRedo: boolean }) {
  const navigation = useNavigation();
  const pendingIntent =
    navigation.state === "submitting" ? navigation.formData?.get("intent") : null;

  return (
    <div className="flex gap-2">
      <Form method="post">
        <input type="hidden" name="intent" value="undo" />
        <button
          type="submit"
          disabled={!canUndo || pendingIntent === "undo"}
          className="rounded-full border-2 border-border bg-surface px-4 py-1.5 text-sm font-bold transition hover:bg-neutral-100 disabled:opacity-40"
        >
          ← 元に戻す
        </button>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="redo" />
        <button
          type="submit"
          disabled={!canRedo || pendingIntent === "redo"}
          className="rounded-full border-2 border-border bg-surface px-4 py-1.5 text-sm font-bold transition hover:bg-neutral-100 disabled:opacity-40"
        >
          やり直す →
        </button>
      </Form>
    </div>
  );
}
