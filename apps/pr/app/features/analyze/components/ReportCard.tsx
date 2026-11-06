import { Button, Card, Heading, Stack, Text } from "@gdgjp/design-system";
import { Form } from "react-router";
import type { AnalyzeReport } from "../report";

/** The weekly report, and each proposal with its own "apply" (nothing is applied automatically). */
export function ReportCard({
  report,
  canApply,
  busy,
}: { report: AnalyzeReport; canApply: boolean; busy: boolean }) {
  const apply = (intent: string, index?: number) =>
    canApply ? (
      <Form method="post" className="inline">
        <input type="hidden" name="index" value={index ?? 0} />
        <Button
          type="submit"
          name="intent"
          value={intent}
          size="sm"
          variant="outline"
          loading={busy}
        >
          適用
        </Button>
      </Form>
    ) : null;
  return (
    <Card>
      <Stack>
        <Heading level={2} className="text-lg">
          週次レポート
        </Heading>
        <pre className="whitespace-pre-wrap text-sm">{report.reportMd}</pre>
        <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="所見">
          {report.findings.map((f) => (
            <li key={`${f.metric}-${f.observation}`}>
              {f.observation}（{f.evidence}）
            </li>
          ))}
        </ul>
        <Heading level={3} className="text-base">
          予算の付け替え
        </Heading>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          X {report.budgetReallocation.byMedium.x_ads.toLocaleString("ja-JP")} 円 / Instagram{" "}
          {report.budgetReallocation.byMedium.ig_ads.toLocaleString("ja-JP")} 円 / 印刷{" "}
          {report.budgetReallocation.byMedium.print.toLocaleString("ja-JP")} 円{" "}
          {apply("apply-budget")}
        </div>
        <Text tone="muted">{report.budgetReallocation.rationaleMd}</Text>
        <Heading level={3} className="text-base">
          スケジュール
        </Heading>
        <ul className="space-y-1 text-sm" aria-label="スケジュールの提案">
          {report.scheduleChanges.map((c, i) => (
            <li
              key={`${c.action}-${c.title ?? c.itemId}`}
              className="flex flex-wrap items-center gap-2"
            >
              {{ add: "追加", move: "移動", drop: "見送り" }[c.action]}: {c.title ?? `#${c.itemId}`}{" "}
              {c.dueAt ?? ""} — {c.reason} {apply("apply-schedule", i)}
            </li>
          ))}
        </ul>
        <Heading level={3} className="text-base">
          画像
        </Heading>
        <ul className="space-y-1 text-sm" aria-label="画像の提案">
          {report.creativeChanges.map((c, i) => (
            <li key={`${c.templateId}-${c.reason}`} className="flex flex-wrap items-center gap-2">
              {c.templateId}: {c.reason}（{c.slotHints}） {apply("apply-creative", i)}
            </li>
          ))}
        </ul>
        <Heading level={3} className="text-base">
          来週
        </Heading>
        <pre className="whitespace-pre-wrap text-sm">{report.nextWeekFocusMd}</pre>
      </Stack>
    </Card>
  );
}
