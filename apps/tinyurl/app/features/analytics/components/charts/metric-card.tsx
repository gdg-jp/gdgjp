import { Card, Stack } from "@gdgjp/design-system";
export function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card>
      <Stack>
        <div className="pb-2">
          <h2 className="text-sm font-medium text-muted">{title}</h2>
        </div>
        <div className="min-w-0">
          <p className="text-3xl font-medium tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
        </div>
      </Stack>
    </Card>
  );
}
