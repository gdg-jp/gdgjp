import { Form, useNavigation } from "react-router";
import type { RevisionKind, RevisionSummary } from "../types";

const KIND_LABELS: Record<RevisionKind, string> = {
  generate: "自動生成",
  edit: "手動編集",
  restore: "復元",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { hour12: false });
}

export function HistoryPanel({
  cursor,
  revisions,
}: {
  cursor: number | null;
  revisions: readonly RevisionSummary[];
}) {
  const navigation = useNavigation();
  const pendingRestoreSeq =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "restore"
      ? Number(navigation.formData.get("seq"))
      : null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-bold">履歴</h2>
      {revisions.length === 0 ? (
        <p className="text-sm text-neutral-600">まだ履歴がありません。</p>
      ) : (
        <ul className="space-y-2">
          {revisions.map((r) => (
            <HistoryRow
              key={r.seq}
              revision={r}
              isCurrent={r.seq === cursor}
              isPending={pendingRestoreSeq === r.seq}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  revision,
  isCurrent,
  isPending,
}: {
  revision: RevisionSummary;
  isCurrent: boolean;
  isPending: boolean;
}) {
  const unfilled = revision.metrics.minShortage + revision.metrics.leadShortage;
  const firstChoicePct = Math.round(revision.metrics.firstChoiceRate * 100);

  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 p-3 text-sm ${
        isCurrent ? "border-gdg-blue bg-gdg-blue/5" : "border-border"
      }`}
    >
      <div>
        <p className="font-bold">
          {revision.label}
          {isCurrent ? <span className="ml-2 text-xs text-gdg-blue">現在</span> : null}
        </p>
        <p className="text-xs text-neutral-500">
          {formatTime(revision.createdAt)} · {revision.actor} · {KIND_LABELS[revision.kind]}
        </p>
        <p className="text-xs text-neutral-500">
          未充足 {unfilled}名 · 第1希望 {firstChoicePct}% · 負荷ばらつき{" "}
          {revision.metrics.loadStdev.toFixed(1)}
        </p>
      </div>
      {isCurrent ? null : (
        <Form method="post">
          <input type="hidden" name="intent" value="restore" />
          <input type="hidden" name="seq" value={revision.seq} />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-full border-2 border-border bg-surface px-4 py-1.5 text-xs font-bold transition hover:bg-neutral-100 disabled:opacity-50"
          >
            戻す
          </button>
        </Form>
      )}
    </li>
  );
}
