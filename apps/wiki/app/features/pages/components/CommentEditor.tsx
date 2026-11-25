import { useEventListener } from "@gdgjp/gdg-lib/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmDialog from "~/components/ConfirmDialog";
import TipTapEditor from "~/features/editor/components/TipTapEditor";

interface CommentEditorProps {
  onSubmit: (json: string) => void;
  onCancel: () => void;
  placeholder?: string;
  isSubmitting?: boolean;
  autoFocus?: boolean;
}

export default function CommentEditor({
  onSubmit,
  onCancel,
  isSubmitting = false,
  autoFocus = false,
}: CommentEditorProps) {
  const { t } = useTranslation("common");
  const [contentJson, setContentJson] = useState("");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const isDirty = (() => {
    if (!contentJson) return false;
    try {
      const doc = JSON.parse(contentJson);
      const content = doc?.content ?? [];
      if (content.length === 0) return false;
      if (content.length === 1 && content[0]?.type === "paragraph") {
        const inner = content[0]?.content ?? [];
        if (inner.length === 0) return false;
      }
      return true;
    } catch {
      return contentJson.trim().length > 0;
    }
  })();

  useEventListener(isDirty && typeof window !== "undefined" ? window : null, "beforeunload", (e) =>
    e.preventDefault(),
  );

  function handleCancel() {
    if (isDirty) {
      setDiscardDialogOpen(true);
    } else {
      onCancel();
    }
  }

  function handleSubmit() {
    if (!isDirty || isSubmitting) return;
    onSubmit(contentJson);
  }

  const [wasSubmitting, setWasSubmitting] = useState(isSubmitting);
  if (wasSubmitting !== isSubmitting) {
    setWasSubmitting(isSubmitting);
    if (!isSubmitting) {
      setContentJson("");
      setResetKey((k) => k + 1);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <TipTapEditor key={resetKey} onChange={setContentJson} />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-neutral"
        >
          {t("wiki.comment.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isDirty || isSubmitting}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("wiki.comment.submit")}
        </button>
      </div>

      <ConfirmDialog
        open={discardDialogOpen}
        title={t("wiki.comment.discard_title")}
        message={t("wiki.comment.discard_message")}
        confirmLabel={t("wiki.comment.discard_confirm")}
        cancelLabel={t("wiki.comment.discard_cancel")}
        destructive
        onConfirm={() => {
          setDiscardDialogOpen(false);
          onCancel();
        }}
        onCancel={() => setDiscardDialogOpen(false)}
      />
    </div>
  );
}
