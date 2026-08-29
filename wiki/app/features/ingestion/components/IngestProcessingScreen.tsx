import { MotionSwap } from "~/components/ui/motion";
import {
  type ToolActivityItem,
  buildLiveActivity,
  formatToolArguments,
} from "~/features/ingestion/live-activity";
import type { IngestionRealtimeEvent } from "../../../../shared/ingestion/realtime-events";

const PHASE_STEPS = [
  { key: "step1", codes: ["parsing", "clarifying", "fetching_urls"] },
  { key: "step2", codes: ["planning", "merging"] },
  { key: "step3", codes: ["generating"] },
  { key: "step4", codes: ["saving"] },
];

function getActiveStep(phaseMessage: string | null): number {
  if (!phaseMessage) return 0;
  const code = phaseMessage.split(":")[0];
  for (let i = 0; i < PHASE_STEPS.length; i++) {
    if (PHASE_STEPS[i].codes.includes(code)) return i;
  }
  return 0;
}

export function ProcessingScreen({
  phaseMessage,
  events,
  t,
}: {
  phaseMessage: string | null;
  events: IngestionRealtimeEvent[];
  t: (k: string) => string;
}) {
  const activeStep = getActiveStep(phaseMessage);
  const stepLabels = [
    t("ingest.phase_step_1"),
    t("ingest.phase_step_2"),
    t("ingest.phase_step_3"),
    t("ingest.phase_step_4"),
  ];
  const activity = buildLiveActivity(events);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-sunken">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-feedback-info-border border-t-blue-600 motion-reduce:animate-none" />
      <div className="text-center">
        <p className="text-lg font-medium text-content-primary">{t("ingest.processing_message")}</p>
      </div>
      <div className="w-72 space-y-2">
        {PHASE_STEPS.map((step, i) => {
          const label = stepLabels[i];
          const isDone = i < activeStep;
          const isActive = i === activeStep;
          const visualState = isDone ? "done" : isActive ? "active" : "pending";
          const detail =
            isActive && phaseMessage?.includes(":")
              ? ` — ${phaseMessage.split(":").slice(1).join(":")}`
              : "";
          return (
            <div key={step.key} className="flex items-center gap-3">
              <MotionSwap
                as="span"
                stateKey={visualState}
                className="inline-flex w-5 justify-center text-center text-sm"
              >
                {isDone ? (
                  "✓"
                ) : isActive ? (
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-action-primary motion-reduce:animate-none" />
                ) : (
                  "○"
                )}
              </MotionSwap>
              <MotionSwap as="span" stateKey={`${visualState}:${detail}`} className="inline-block">
                <span
                  className={
                    isDone
                      ? "text-sm text-feedback-success-foreground"
                      : isActive
                        ? "text-sm font-medium text-content-primary"
                        : "text-sm text-content-disabled"
                  }
                >
                  {label}
                  {detail}
                </span>
              </MotionSwap>
            </div>
          );
        })}
      </div>
      {activity.length > 0 && (
        <div
          className="w-full max-w-xl px-4"
          aria-live="polite"
          aria-label="Live generation activity"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-content-tertiary">
            Live activity
          </p>
          <ul className="space-y-2">
            {activity.map((item) =>
              item.kind === "tool" ? (
                <ToolActivityCard key={item.key} activity={item} />
              ) : (
                <li key={item.key} className="text-xs text-content-tertiary">
                  {eventDescription(item.event)}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
      <p className="text-sm text-content-tertiary">{t("ingest.processing_hint")}</p>
      <p className="text-xs text-content-disabled">{t("ingest.processing_leave_hint")}</p>
    </div>
  );
}

function ToolActivityCard({ activity }: { activity: ToolActivityItem }) {
  const statusLabel =
    activity.status === "running"
      ? "Running"
      : activity.status === "completed"
        ? "Completed"
        : "Failed";
  const statusClass =
    activity.status === "running"
      ? "bg-feedback-info-surface text-action-primary-hover"
      : activity.status === "completed"
        ? "bg-feedback-success-surface text-feedback-success-foreground"
        : "bg-feedback-danger-surface text-feedback-danger-foreground";

  return (
    <li className="rounded-lg border border-border-default bg-surface-raised p-3 text-xs text-content-secondary shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <code className="font-semibold text-content-primary">{activity.tool}</code>
        <span className={`rounded-full px-2 py-0.5 font-medium ${statusClass}`}>{statusLabel}</span>
      </div>
      {activity.summary && <p className="mt-1 text-content-tertiary">{activity.summary}</p>}
      <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-surface-sunken p-2 font-mono text-[11px] leading-4 text-content-secondary">
        {formatToolArguments(activity.args)}
      </pre>
      {(activity.durationMs !== undefined ||
        activity.truncated ||
        activity.errorCode !== undefined) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-content-tertiary">
          {activity.durationMs !== undefined && <span>{activity.durationMs} ms</span>}
          {activity.truncated && <span>Output truncated</span>}
          {activity.errorCode !== undefined && <span>{activity.errorCode}</span>}
        </div>
      )}
    </li>
  );
}

function eventDescription(event: IngestionRealtimeEvent): string {
  switch (event.type) {
    case "workflow_started":
      return "Generation started";
    case "model_started":
      return `Running ${event.program}`;
    case "model_step":
      return `${event.program}: step ${event.step} of ${event.limit}`;
    case "tool_started":
      return displaySafeSummary(event.summary);
    case "tool_completed":
      return `${event.tool} completed`;
    case "tool_failed":
      return `${event.tool} could not complete`;
    case "operation_started":
      return `Preparing operation ${event.index + 1} of ${event.total}`;
    case "operation_completed":
      return `Prepared operation ${event.index + 1} of ${event.total}`;
    case "awaiting_input":
      return "Waiting for your input";
    case "completed":
      return "Generation completed";
    case "failed":
      return "Generation could not complete";
  }
}

function displaySafeSummary(summary: string): string {
  const compact = summary.replaceAll(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}
