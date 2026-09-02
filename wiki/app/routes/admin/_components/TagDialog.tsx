import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useNavigation } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

export interface TagRow {
  slug: string;
  labelJa: string;
  labelEn: string;
  color: string;
  pageCount: number;
}

interface TagActionData {
  ok?: boolean;
  created?: string;
  updated?: string;
  deleted?: boolean;
  errorKey?: string;
  errorParams?: Record<string, string>;
}

export interface TagDialogProps {
  mode: "create" | "edit";
  tag?: TagRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TagDialog({ mode, tag, open, onOpenChange }: TagDialogProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const actionData = useActionData<TagActionData>();

  const [currentError, setCurrentError] = useState<{
    errorKey: string;
    errorParams?: Record<string, string>;
  } | null>(null);
  const [submittingThis, setSubmittingThis] = useState(false);
  const pendingSubmissionRef = useRef(false);
  const prevActionDataRef = useRef(actionData);

  // Reset error and submission state when dialog closes
  useEffect(() => {
    if (!open) {
      setCurrentError(null);
      setSubmittingThis(false);
      pendingSubmissionRef.current = false;
    }
  }, [open]);

  // Reset error visibility and submission state when mode or tag changes
  const activeSlug = tag?.slug;
  const prevTargetRef = useRef({ mode, slug: activeSlug });
  useEffect(() => {
    if (prevTargetRef.current.mode !== mode || prevTargetRef.current.slug !== activeSlug) {
      prevTargetRef.current = { mode, slug: activeSlug };
      setCurrentError(null);
      setSubmittingThis(false);
      pendingSubmissionRef.current = false;
    }
  }, [mode, activeSlug]);

  // Handle action result ONLY if this open dialog initiated the pending submission
  useEffect(() => {
    if (actionData !== prevActionDataRef.current) {
      prevActionDataRef.current = actionData;
      if (open && pendingSubmissionRef.current) {
        pendingSubmissionRef.current = false;
        setSubmittingThis(false);
        if (actionData?.ok) {
          setCurrentError(null);
          onOpenChange(false);
        } else if (actionData?.errorKey) {
          setCurrentError({
            errorKey: actionData.errorKey,
            errorParams: actionData.errorParams,
          });
        }
      }
    }
  }, [actionData, open, onOpenChange]);

  // Handle navigation idle in case actionData didn't change referentially
  useEffect(() => {
    if (open && pendingSubmissionRef.current && navigation.state === "idle") {
      pendingSubmissionRef.current = false;
      setSubmittingThis(false);
      if (actionData?.ok) {
        setCurrentError(null);
        onOpenChange(false);
      } else if (actionData?.errorKey) {
        setCurrentError({
          errorKey: actionData.errorKey,
          errorParams: actionData.errorParams,
        });
      }
    }
  }, [navigation.state, open, actionData, onOpenChange]);

  const handleSubmit = () => {
    pendingSubmissionRef.current = true;
    setSubmittingThis(true);
    setCurrentError(null);
  };

  const isSubmitting = submittingThis && navigation.state === "submitting";
  const formKey = mode === "edit" ? `edit-${tag?.slug}` : "create";
  const title =
    mode === "create"
      ? t("admin.tags.new_tag_dialog_title")
      : t("admin.tags.edit_tag_dialog_title");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border border-border-default bg-surface-raised p-6 text-content-primary">
        <DialogHeader className="p-0">
          <DialogTitle className="text-lg font-semibold text-content-primary">{title}</DialogTitle>
        </DialogHeader>

        {currentError && (
          <div className="rounded-md bg-feedback-danger-surface px-4 py-3 text-sm text-feedback-danger-foreground">
            {t(currentError.errorKey, currentError.errorParams)}
          </div>
        )}

        <Form method="post" key={formKey} onSubmit={handleSubmit} className="space-y-4">
          <input
            type="hidden"
            name="intent"
            value={mode === "create" ? "createTag" : "updateTag"}
          />

          <div className="grid grid-cols-2 gap-4">
            {mode === "create" ? (
              <div>
                <label
                  htmlFor="tag-slug"
                  className="mb-1 block text-sm font-medium text-content-secondary"
                >
                  {t("admin.tags.form.slug")}
                </label>
                <input
                  id="tag-slug"
                  type="text"
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="my-tag"
                  className="w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm text-content-primary focus:border-border-focus focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <span className="mb-1 block text-sm font-medium text-content-secondary">
                  {t("admin.tags.form.slug")}
                </span>
                <div className="rounded-md border border-border-default bg-surface-sunken px-3 py-2 font-mono text-sm text-content-secondary">
                  {tag?.slug}
                </div>
                <input type="hidden" name="slug" value={tag?.slug ?? ""} />
              </div>
            )}

            <div>
              <label
                htmlFor="tag-color"
                className="mb-1 block text-sm font-medium text-content-secondary"
              >
                {t("admin.tags.form.color")}
              </label>
              <input
                id="tag-color"
                type="color"
                name="color"
                defaultValue={mode === "edit" && tag?.color ? tag.color : "#3b82f6"} // design-token-policy: allow-dynamic-color
                className="h-10 w-full cursor-pointer rounded-md border border-border-strong bg-surface-raised"
              />
            </div>

            <div>
              <label
                htmlFor="tag-label-ja"
                className="mb-1 block text-sm font-medium text-content-secondary"
              >
                {t("admin.tags.form.label_ja")}
              </label>
              <input
                id="tag-label-ja"
                type="text"
                name="labelJa"
                required
                defaultValue={mode === "edit" ? (tag?.labelJa ?? "") : ""}
                className="w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm text-content-primary focus:border-border-focus focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="tag-label-en"
                className="mb-1 block text-sm font-medium text-content-secondary"
              >
                {t("admin.tags.form.label_en")}
              </label>
              <input
                id="tag-label-en"
                type="text"
                name="labelEn"
                required
                defaultValue={mode === "edit" ? (tag?.labelEn ?? "") : ""}
                className="w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm text-content-primary focus:border-border-focus focus:outline-none"
              />
            </div>
          </div>

          <DialogFooter className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-content-secondary hover:bg-surface-hover"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50"
            >
              {mode === "create" ? t("admin.tags.form.submit") : t("admin.tags.form.update")}
            </button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
