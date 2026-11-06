import { Badge, Checkbox, Heading, Stack } from "@gdgjp/design-system";
import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";

const TONE = { pass: "success", fail: "danger", unevaluated: "neutral" } as const;
const LABEL = { pass: "OK", fail: "NG", unevaluated: "未評価" } as const;

/** Playbook check results. `review` rules (unevaluated, "人が判断する") are a checklist for the reviewer. */
export function CheckResults({ results }: { results: CheckResult[] }) {
  const sorted = [...results].sort((a, b) => order(a) - order(b));
  const failsMust = results.filter((r) => r.status === "fail" && r.strength === "MUST").length;
  return (
    <Stack>
      <Heading level={2} className="text-lg">
        Playbook の検査{" "}
        {failsMust ? (
          <Badge tone="danger">MUST {failsMust} 件 NG</Badge>
        ) : (
          <Badge tone="success">MUST はすべて OK</Badge>
        )}
      </Heading>
      <ul className="space-y-1 text-sm">
        {sorted.map((r) => (
          <li key={r.ruleId} className="flex flex-wrap items-start gap-2">
            {r.detail.startsWith("review:") ? (
              <span className="inline-flex items-center gap-1">
                <Checkbox id={`check-${r.ruleId}`} aria-label={`${r.ruleId} を確認した`} />
              </span>
            ) : (
              <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
            )}
            <span className="font-mono text-xs">{r.ruleId}</span>
            <span className="text-muted">{r.strength}</span>
            {r.detail ? <span className="min-w-0 flex-1 break-words">{r.detail}</span> : null}
          </li>
        ))}
      </ul>
    </Stack>
  );
}

function order(r: CheckResult) {
  if (r.status === "fail") return r.strength === "MUST" ? 0 : 1;
  if (r.status === "unevaluated") return 2;
  return 3;
}
