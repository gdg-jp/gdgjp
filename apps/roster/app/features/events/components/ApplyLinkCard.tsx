import { useState } from "react";
import { Form } from "react-router";
import { type EventStatus, STATUSES, STATUS_LABELS } from "~/features/events/status";

export function ApplyLinkCard({
  applyUrl,
  status,
  canApplyNow,
  error,
}: {
  applyUrl: string;
  status: EventStatus;
  canApplyNow: boolean;
  error?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">スタッフ登録URL</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            canApplyNow ? "bg-gdg-green/15 text-gdg-green" : "bg-background text-muted"
          }`}
        >
          {canApplyNow ? "募集中" : "受付停止中"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="block flex-1 break-all rounded-xl bg-neutral-100 p-3 text-sm">
          {applyUrl}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(applyUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {}
          }}
          className="rounded-full border-2 border-border bg-surface px-4 py-2 text-sm font-bold transition hover:bg-neutral-100"
        >
          {copied ? "コピーしました" : "コピー"}
        </button>
        <a
          href={applyUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-background"
        >
          登録画面を開く
        </a>
      </div>

      {!canApplyNow ? (
        <p className="rounded-lg border border-border bg-background p-3 text-sm font-medium">
          ステータスを「{STATUS_LABELS.open}」にすると登録できます。
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-gdg-red">
          {error}
        </p>
      ) : null}

      <Form method="post" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="updateStatus" />
        <label className="space-y-1 text-sm">
          <span className="block font-medium">ステータス</span>
          <select
            name="status"
            defaultValue={status}
            className="rounded-xl border-2 border-border bg-surface p-2 outline-none focus:ring-4 focus:ring-gdg-blue/40"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-full border-2 border-border bg-gdg-blue px-4 py-2 text-sm font-bold text-primary-foreground transition hover:brightness-95"
        >
          ステータスを更新
        </button>
      </Form>
    </section>
  );
}
