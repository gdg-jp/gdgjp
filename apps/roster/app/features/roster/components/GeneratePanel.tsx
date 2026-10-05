import { Form, useNavigation } from "react-router";

export type GenerateResult = { ok: true; ms: number; seed: number } | { ok: false; error: string };

/**
 * The "自動生成" control (docs/roster/07-roster-manual-edit.md "Design" §2).
 * The seed is a plain number input defaulting to `events.seed`; submitting
 * with a changed value persists it there too (`e.$id.roster.tsx`'s action),
 * so "同じ入力とシードなら同じ結果になる" is directly demonstrable by
 * re-generating without touching the field. MVP has no server-sent progress
 * (a Worker action can't stream partial results), so this only disables the
 * button and shows a spinner while the action runs (index.md §5's "生成"
 * step; docs/roster/07-roster-manual-edit.md Design §2 "進捗表示").
 */
export function GeneratePanel({
  seed,
  hasAssignments,
  lastResult,
}: {
  seed: number;
  hasAssignments: boolean;
  lastResult?: GenerateResult;
}) {
  const navigation = useNavigation();
  const isGenerating =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "generate";

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-bold">シフト生成</h2>
          <p className="text-sm text-neutral-600">
            {hasAssignments ? "現在の条件でシフトを作り直します。" : "まだ生成していません。"}
          </p>
        </div>
        <Form method="post" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="generate" />
          <label className="space-y-1 text-sm">
            <span className="block font-medium">シード</span>
            <input
              type="number"
              name="seed"
              defaultValue={seed}
              required
              className="w-32 rounded-xl border-2 border-border bg-surface p-2 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>
          <button
            type="submit"
            disabled={isGenerating}
            className="rounded-full border-2 border-border bg-gdg-blue px-6 py-2.5 font-bold text-primary-foreground transition hover:brightness-95 disabled:opacity-50"
          >
            {isGenerating ? "生成中…" : hasAssignments ? "再生成" : "自動生成"}
          </button>
        </Form>
      </div>

      {lastResult?.ok ? (
        <p className="text-sm text-neutral-600">
          前回の実行: {lastResult.ms}ms · シード {lastResult.seed}
        </p>
      ) : null}
      {lastResult && !lastResult.ok ? (
        <p role="alert" className="text-sm font-medium text-gdg-red">
          {lastResult.error}
        </p>
      ) : null}
    </section>
  );
}
