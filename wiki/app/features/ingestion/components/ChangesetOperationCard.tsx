import { useTranslation } from "react-i18next";
import TipTapEditor from "~/features/editor/components/TipTapEditor";
import type { ChangesetOperation } from "../../../../shared/ingestion/domain";
import {
  CANONICAL_TAG_SLUGS,
  type OperationState,
  PAGE_TYPE_VALUES,
  buildMarkdownFromDraft,
  buildMarkdownFromPatch,
  resolveImgPlaceholders,
} from "./changeset-review-helpers";

export type FlatPageOption = {
  id: string;
  titleJa: string;
  titleEn: string;
  slug: string;
  depth: number;
};

/** One editable CREATE / UPDATE operation card in the changeset review. */
export function ChangesetOperationCard({
  op,
  state,
  idx,
  operations,
  opStates,
  imageUrlMap,
  existingPageFlatList,
  feedbackValue,
  regenerating,
  regenerateError,
  onUpdateOp,
  onToggleTag,
  onFeedbackChange,
  onRegenerate,
}: {
  op: ChangesetOperation;
  state: OperationState;
  idx: number;
  operations: ChangesetOperation[];
  opStates: OperationState[];
  imageUrlMap: Record<string, string>;
  existingPageFlatList: FlatPageOption[];
  feedbackValue: string;
  regenerating: boolean;
  regenerateError: string | null;
  onUpdateOp: (updates: Partial<OperationState>) => void;
  onToggleTag: (slug: string) => void;
  onFeedbackChange: (value: string) => void;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation();
  const score = op.draft?.actionabilityScore ?? op.patch?.actionabilityScore;
  const notes = op.draft?.actionabilityNotes ?? op.patch?.actionabilityNotes;
  const draftMarkdown = resolveImgPlaceholders(
    op.draft
      ? buildMarkdownFromDraft(op.draft)
      : op.patch
        ? buildMarkdownFromPatch(op.patch, op.existingTipTapJson)
        : "",
    imageUrlMap,
  );

  // Other CREATE ops in this changeset (for parent selector)
  const otherCreateOps = operations
    .map((o, i) => ({ op: o, state: opStates[i], idx: i }))
    .filter(({ op: o, idx: i }) => i !== idx && o.type === "create" && o.tempId);

  return (
    <div className="rounded-xl border border-default bg-surface-raised p-6 shadow-sm">
      {/* Op header */}
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            op.type === "create"
              ? "bg-feedback-success-surface text-feedback-success-foreground"
              : "bg-feedback-info-surface text-action-primary"
          }`}
        >
          {op.type === "create" ? t("ingest.review.op_create") : t("ingest.review.op_update")}
        </span>
        <span className="text-sm text-content-secondary">{op.rationale}</span>
      </div>

      {/* Actionability score banner */}
      {score && score < 3 && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm ${
            score === 1
              ? "border border-feedback-danger-border bg-feedback-danger-surface text-feedback-danger-foreground"
              : "border border-feedback-warning-border bg-feedback-warning-surface text-feedback-warning-foreground"
          }`}
        >
          <strong>
            {t("ingest.review.actionability_score", { score })}
            {score === 1 && ` ${t("ingest.review.actionability_regen_hint")}`}
          </strong>
          {notes && <p className="mt-1">{notes}</p>}
        </div>
      )}

      {/* Parent page selector (CREATE only) */}
      {op.type === "create" && (
        <div className="mb-4">
          <label
            htmlFor={`parent-${idx}`}
            className="mb-1 block text-xs font-medium text-content-secondary"
          >
            {t("ingest.review.field_parent_page")}
          </label>
          <select
            id={`parent-${idx}`}
            value={state?.parentId ?? ""}
            onChange={(e) => onUpdateOp({ parentId: e.target.value || null })}
            className="w-full rounded-lg border border-default px-3 py-2 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
          >
            <option value="">{t("ingest.review.parent_none")}</option>
            {existingPageFlatList.length > 0 && (
              <optgroup label={t("ingest.review.existing_pages")}>
                {existingPageFlatList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {" ".repeat(p.depth)}
                    {p.titleJa || p.titleEn || p.slug}
                  </option>
                ))}
              </optgroup>
            )}
            {otherCreateOps.length > 0 && (
              <optgroup label={t("ingest.review.new_pages_in_changeset")}>
                {otherCreateOps.map(({ op: o, state: s }) => (
                  <option key={o.tempId} value={o.tempId ?? ""}>
                    {s?.title || "(Untitled)"}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      {/* Title */}
      <div className="mb-4">
        <label
          htmlFor={`title-${idx}`}
          className="mb-1 block text-xs font-medium text-content-secondary"
        >
          {t("ingest.review.field_title")}
        </label>
        <input
          id={`title-${idx}`}
          type="text"
          value={state.title}
          onChange={(e) => onUpdateOp({ title: e.target.value })}
          className="w-full rounded-lg border border-default px-3 py-2 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
        />
      </div>

      {/* Summary */}
      <div className="mb-4">
        <label
          htmlFor={`summary-${idx}`}
          className="mb-1 block text-xs font-medium text-content-secondary"
        >
          {t("ingest.review.field_summary")}
        </label>
        <textarea
          id={`summary-${idx}`}
          value={state.summaryJa}
          onChange={(e) => onUpdateOp({ summaryJa: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-default px-3 py-2 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
        />
      </div>

      {/* Page type */}
      <div className="mb-4">
        <label
          htmlFor={`pagetype-${idx}`}
          className="mb-1 block text-xs font-medium text-content-secondary"
        >
          {t("ingest.review.field_page_type")}
        </label>
        <select
          id={`pagetype-${idx}`}
          value={state.pageType}
          onChange={(e) => onUpdateOp({ pageType: e.target.value })}
          className="rounded-lg border border-default px-3 py-2 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
        >
          {PAGE_TYPE_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`ingest.review.pageType.${value}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Tags */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-content-secondary">
          {t("ingest.review.field_tags")}
        </p>
        <div className="flex flex-wrap gap-2">
          {CANONICAL_TAG_SLUGS.map((slug) => (
            <button
              key={slug}
              type="button"
              onClick={() => onToggleTag(slug)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                state.tags.includes(slug)
                  ? "bg-action-primary text-content-inverse"
                  : "bg-surface-sunken text-content-secondary hover:bg-surface-hover"
              }`}
            >
              {t(`ingest.review.tag.${slug}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-content-secondary">
          {t("ingest.review.field_body")}
        </p>
        <TipTapEditor
          initialMarkdown={draftMarkdown}
          onChange={(json) => onUpdateOp({ tiptapJson: json })}
        />
      </div>

      {/* Regenerate */}
      <div className="mt-4 border-t border-subtle pt-4">
        <label
          htmlFor={`feedback-${idx}`}
          className="mb-1 block text-xs font-medium text-content-secondary"
        >
          {t("ingest.review.field_feedback")}
        </label>
        <div className="flex gap-2">
          <input
            id={`feedback-${idx}`}
            type="text"
            value={feedbackValue}
            onChange={(e) => onFeedbackChange(e.target.value)}
            placeholder={t("ingest.review.feedback_placeholder")}
            className="flex-1 rounded-lg border border-default px-3 py-2 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
          />
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating || !feedbackValue.trim()}
            className="rounded-lg border border-default px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-canvas disabled:opacity-50"
          >
            {regenerating ? t("ingest.review.regenerating") : t("ingest.review.regenerate")}
          </button>
        </div>
        {regenerateError && (
          <p className="mt-2 text-xs text-feedback-danger-foreground">{regenerateError}</p>
        )}
      </div>
    </div>
  );
}
