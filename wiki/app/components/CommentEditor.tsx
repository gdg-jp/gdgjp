import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmDialog from "~/components/ConfirmDialog";
import TipTapEditor from "~/components/TipTapEditor";

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

  // Whether the editor has actual content (not just an empty ProseMirror doc)
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

  // Register beforeunload when dirty
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

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

  // Reset after successful submission (when isSubmitting returns to false after a cycle)
  const wasSubmittingRef = useRef(false);
  useEffect(() => {
    if (wasSubmittingRef.current && !isSubmitting) {
      setContentJson("");
      setResetKey((k) => k + 1);
    }
    wasSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  return (
    <div className="flex flex-col gap-2">
      <TipTapEditor key={resetKey} onChange={setContentJson} />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          {t("wiki.comment.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isDirty || isSubmitting}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
