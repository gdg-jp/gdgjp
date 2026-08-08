import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import TipTapEditor from "~/components/TipTapEditor";
import PageStructurePreview from "~/components/ingest/PageStructurePreview";
import { buildTree, flattenTree } from "~/lib/page-tree";
import { applyPatchesToMarkdown, tiptapToMarkdown } from "~/lib/tiptap-convert";
import type { AiDraftJson, ChangesetOperation } from "../../../shared/ingestion/domain";

type ResultDraft = Extract<AiDraftJson, { planRationale: string }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_TYPE_VALUES = [
  "event-report",
  "speaker-profile",
  "project-log",
  "how-to-guide",
  "onboarding-guide",
  "survey-report",
] as const;

const CANONICAL_TAG_SLUGS = [
  "event-operations",
  "speaker-management",
  "sponsor-relations",
  "project",
  "onboarding",
  "community-ops",
  "technical",
  "template",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageIndexEntry {
  id: string;
  titleJa: string;
  titleEn: string;
  slug: string;
  parentId: string | null;
}

interface OperationState {
  title: string;
  tiptapJson: string;
  summaryJa: string;
  pageType: string;
  tags: string[];
  pageMetadata: Record<string, string>;
  suggestedSlug?: string;
  parentId: string | null;
}

interface ChangesetReviewProps {
  draft: ResultDraft;
  sessionId: string;
  imageKeys?: string[];
  pageIndex?: PageIndexEntry[];
  onRegenerate?: (input: {
    operationIndex: number;
    feedback: string;
  }) => Promise<{ operation: ChangesetOperation } | null>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChangesetReview({
  draft,
  sessionId,
  imageKeys,
  pageIndex = [],
  onRegenerate,
}: ChangesetReviewProps) {
  const { t } = useTranslation();
  const imageUrlMap = buildImageUrlMap(imageKeys ?? []);
  const [operations, setOperations] = useState(draft.operations);
  const [opStates, setOpStates] = useState<OperationState[]>(() =>
    draft.operations.map((op) => initOpState(op)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string[]>(draft.operations.map(() => ""));
  const [regenerating, setRegenerating] = useState<boolean[]>(draft.operations.map(() => false));
  const [regenerateErrors, setRegenerateErrors] = useState<(string | null)[]>(
    draft.operations.map(() => null),
  );

  // Flat list of existing pages for the parent selector (ordered by tree depth)
  const existingPageFlatList = useMemo(
    () => flattenTree(buildTree(pageIndex.map((p) => ({ ...p, sortOrder: 0 })))),
    [pageIndex],
  );

  // Sibling warning — count CREATE ops with no parent
  const rootLevelCreateCount = useMemo(
    () =>
      operations.reduce((count, op, idx) => {
        if (op.type === "create" && opStates[idx]?.parentId === null) return count + 1;
        return count;
      }, 0),
    [operations, opStates],
  );
  const showSiblingWarning = rootLevelCreateCount >= 2;

  function updateOp(idx: number, updates: Partial<OperationState>) {
    setOpStates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
  }

  function toggleTag(idx: number, slug: string) {
    setOpStates((prev) => {
      const next = [...prev];
      const tags = next[idx].tags;
      const removing = tags.includes(slug);
      if (!removing && tags.length >= 5) return prev;
      next[idx] = {
        ...next[idx],
        tags: removing ? tags.filter((t) => t !== slug) : [...tags, slug],
      };
      return next;
    });
  }

  function handleAddParentPage() {
    const newTempId = crypto.randomUUID();

    const newOp: ChangesetOperation = {
      type: "create",
      tempId: newTempId,
      rationale: t("ingest.review.add_parent_page"),
      evidencePaths: [],
      draft: null,
      patch: null,
    };
    const newState: OperationState = {
      title: "",
      tiptapJson: "",
      summaryJa: "",
      pageType: "how-to-guide",
      tags: [],
      pageMetadata: {},
      parentId: null,
    };

    // Prepend the new op, nesting all state updates inside functional updater
    setOperations((prevOps) => {
      const newOps = [newOp, ...prevOps];
      setOpStates((prevStates) => {
        const updated = prevStates.map((s, i) => {
          if (prevOps[i]?.type === "create" && s.parentId === null) {
            return { ...s, parentId: newTempId };
          }
          return s;
        });
        return [newState, ...updated];
      });
      setFeedback((prev) => ["", ...prev]);
      setRegenerating((prev) => [false, ...prev]);
      setRegenerateErrors((prev) => [null, ...prev]);
      return newOps;
    });
  }

  async function handleRegenerate(idx: number) {
    setRegenerating((prev) => {
      const n = [...prev];
      n[idx] = true;
      return n;
    });
    try {
      const input = { operationIndex: idx, feedback: feedback[idx] };
      const agentResult = await onRegenerate?.(input);
      if (agentResult) {
        applyRegeneratedOperation(idx, agentResult.operation);
      } else {
        const res = await fetch(`/api/ingest/${sessionId}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (res.ok) {
          const data = (await res.json()) as { operation: ChangesetOperation };
          applyRegeneratedOperation(idx, data.operation);
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          const msg = data.error ?? t("ingest.review.regenerate_error_generic");
          setRegenerateErrors((prev) => {
            const next = [...prev];
            next[idx] = msg;
            return next;
          });
        }
      }
    } catch {
      setRegenerateErrors((prev) => {
        const next = [...prev];
        next[idx] = t("ingest.review.regenerate_error_generic");
        return next;
      });
    } finally {
      setRegenerating((prev) => {
        const n = [...prev];
        n[idx] = false;
        return n;
      });
    }
  }

  function applyRegeneratedOperation(idx: number, operation: ChangesetOperation) {
    setOperations((prev) => {
      const next = [...prev];
      next[idx] = operation;
      return next;
    });
    setOpStates((prev) => {
      const next = [...prev];
      const prevParentId = next[idx]?.parentId ?? null;
      next[idx] = { ...initOpState(operation), parentId: prevParentId };
      return next;
    });
    setRegenerateErrors((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const body = {
        operations: operations.map((op, idx) => ({
          type: op.type,
          tempId: op.tempId,
          pageId: op.pageId,
          title: opStates[idx].title,
          tiptapJson: opStates[idx].tiptapJson,
          summaryJa: opStates[idx].summaryJa,
          pageType: opStates[idx].pageType,
          pageMetadata: opStates[idx].pageMetadata,
          tags: opStates[idx].tags,
          suggestedSlug: opStates[idx].suggestedSlug,
          suggestedParentId: opStates[idx].parentId,
          actionabilityScore: op.draft?.actionabilityScore ?? op.patch?.actionabilityScore ?? 2,
        })),
        sources: draft.sources ?? [],
      };

      const res = await fetch(`/api/ingest/${sessionId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        window.location.href = "/";
      } else {
        const err = await res.text();
        alert(t("ingest.review.error", { message: err }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Plan rationale */}
      <div className="rounded-lg border border-feedback-info-border bg-feedback-info-surface p-4">
        <h3 className="text-sm font-medium text-feedback-info-foreground">
          {t("ingest.review.ai_rationale")}
        </h3>
        <p className="mt-1 text-sm text-action-primary">{draft.planRationale}</p>
      </div>

      {/* Warnings */}
      {draft.warnings && draft.warnings.length > 0 && (
        <div className="rounded-lg border border-feedback-warning-border bg-feedback-warning-surface p-4">
          <h3 className="text-sm font-medium text-feedback-warning-foreground">
            {t("ingest.review.warnings")}
          </h3>
          <ul className="mt-1 list-disc pl-4 text-sm text-feedback-warning-foreground">
            {draft.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Sibling warning */}
      {showSiblingWarning && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-feedback-warning-border bg-feedback-warning-surface p-4">
          <p className="text-sm text-feedback-warning-foreground">
            {t("ingest.review.sibling_warning", { count: rootLevelCreateCount })}
          </p>
          <button
            type="button"
            onClick={handleAddParentPage}
            className="shrink-0 rounded-lg border border-feedback-warning-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-feedback-warning-foreground hover:bg-feedback-warning-surface"
          >
            {t("ingest.review.add_parent_page")}
          </button>
        </div>
      )}

      {/* Operation cards */}
      {operations.map((op, idx) => {
        const state = opStates[idx];
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
        const opKey = op.tempId ?? op.pageId ?? String(idx);

        // Other CREATE ops in this changeset (for parent selector)
        const otherCreateOps = operations
          .map((o, i) => ({ op: o, state: opStates[i], idx: i }))
          .filter(({ op: o, idx: i }) => i !== idx && o.type === "create" && o.tempId);

        return (
          <div
            key={opKey}
            className="rounded-xl border border-default bg-surface-raised p-6 shadow-sm"
          >
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
                  onChange={(e) => updateOp(idx, { parentId: e.target.value || null })}
                  className="w-full rounded-lg border border-default px-3 py-2 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                >
                  <option value="">{t("ingest.review.parent_none")}</option>
                  {existingPageFlatList.length > 0 && (
                    <optgroup label={t("ingest.review.existing_pages")}>
                      {existingPageFlatList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {"\u2003".repeat(p.depth)}
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
                onChange={(e) => updateOp(idx, { title: e.target.value })}
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
                onChange={(e) => updateOp(idx, { summaryJa: e.target.value })}
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
                onChange={(e) => updateOp(idx, { pageType: e.target.value })}
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
                    onClick={() => toggleTag(idx, slug)}
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
                onChange={(json) => updateOp(idx, { tiptapJson: json })}
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
                  value={feedback[idx]}
                  onChange={(e) => {
                    const next = [...feedback];
                    next[idx] = e.target.value;
                    setFeedback(next);
                  }}
                  placeholder={t("ingest.review.feedback_placeholder")}
                  className="flex-1 rounded-lg border border-default px-3 py-2 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
                <button
                  type="button"
                  onClick={() => handleRegenerate(idx)}
                  disabled={regenerating[idx] || !feedback[idx].trim()}
                  className="rounded-lg border border-default px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-canvas disabled:opacity-50"
                >
                  {regenerating[idx]
                    ? t("ingest.review.regenerating")
                    : t("ingest.review.regenerate")}
                </button>
              </div>
              {regenerateErrors[idx] && (
                <p className="mt-2 text-xs text-feedback-danger-foreground">
                  {regenerateErrors[idx]}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* Page structure preview */}
      <PageStructurePreview pageIndex={pageIndex} operations={operations} opStates={opStates} />

      {/* Submit buttons */}
      <div className="flex justify-end gap-3 border-t border-subtle pt-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-action-primary px-5 py-2.5 text-sm font-medium text-content-inverse transition-colors hover:bg-action-primary-hover disabled:opacity-50"
        >
          {submitting ? t("ingest.review.publishing") : t("ingest.review.publish")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initOpState(op: ChangesetOperation): OperationState {
  const draft = op.draft;
  return {
    title: draft?.title.ja ?? op.pageTitle ?? "",
    tiptapJson: "",
    summaryJa: draft?.summary.ja ?? "",
    pageType: draft?.suggestedPageType ?? "how-to-guide",
    tags: draft?.suggestedTags ?? [],
    pageMetadata: draft?.metadata ?? {},
    suggestedSlug: draft?.suggestedSlug,
    parentId: draft?.suggestedParentId ?? null,
  };
}

function buildMarkdownFromDraft(
  draft: import("../../../shared/ingestion/domain").PageDraft,
): string {
  return draft.sections.map((section) => `## ${section.heading}\n\n${section.body}`).join("\n\n");
}

function buildMarkdownFromPatch(
  patch: import("../../../shared/ingestion/domain").SectionPatchResponse,
  existingTipTapJson?: string,
): string {
  const existingMarkdown = existingTipTapJson ? tiptapToMarkdown(existingTipTapJson) : "";
  return applyPatchesToMarkdown(existingMarkdown, patch.sectionPatches);
}

function buildImageUrlMap(imageKeys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of imageKeys) {
    const name = key.split("/").at(-1) ?? key;
    map[name] = `/api/images/${key}`;
  }
  return map;
}

function resolveImgPlaceholders(markdown: string, imageUrlMap: Record<string, string>): string {
  return markdown.replace(/\(img:([^)]+)\)/g, (_, name) => `(${imageUrlMap[name] ?? "#"})`);
}
