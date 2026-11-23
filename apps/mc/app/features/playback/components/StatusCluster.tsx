import { IconButton, Icons } from "@gdgjp/design-system";
import { blockingIssues, issueText, issuesOf } from "../diagnostics";
import { useController } from "./controller-context";

export function StatusCluster({ onOpenDiagnostics }: { onOpenDiagnostics: () => void }) {
  const { room } = useController();
  const alive = room.players.filter((p) => p.alive).length;
  const issues = issuesOf(room);
  const selfOk = room.socket === "open";
  const playerState = !selfOk ? "unknown" : alive === 0 ? "down" : alive > 1 ? "multi" : "ok";

  return (
    <div className="mc-status">
      <span
        className="mc-lamp"
        data-state={selfOk ? "ok" : "down"}
        role="img"
        aria-label={selfOk ? "司会PC 接続中" : issueText["self-offline"]}
      >
        {selfOk ? (
          <Icons name="Wifi" size={18} aria-hidden="true" />
        ) : (
          <Icons name="WifiLow" size={18} aria-hidden="true" />
        )}
      </span>
      <span
        className="mc-lamp"
        data-state={playerState}
        role="img"
        aria-label={
          playerState === "ok"
            ? "配信PC 接続中"
            : playerState === "multi"
              ? issueText["multi-player"]
              : issueText["no-player"]
        }
        data-testid="player-lamp"
      >
        <Icons name="Radio" size={18} aria-hidden="true" />
        {alive > 1 && <span className="mc-lamp-count">{alive}</span>}
      </span>
      <IconButton
        aria-label="診断"
        variant="ghost"
        className="mc-diag-button"
        data-alert={issues.length > 0 || undefined}
        onClick={onOpenDiagnostics}
      >
        <Icons name="Activity" size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function IssueStrip() {
  const { room } = useController();
  const issue = issuesOf(room).find((i) => blockingIssues.has(i));
  return (
    <div className="mc-strip" data-visible={issue ? true : undefined} role="alert">
      {issue && (
        <>
          <Icons name="AlertTriangle" size={18} aria-hidden="true" />
          <span data-testid="issue">{issueText[issue]}</span>
        </>
      )}
    </div>
  );
}
