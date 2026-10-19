import { IconButton, Input } from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, Timer as TimerIcon } from "~/components/icons";
import type { ClientMessage, Timer } from "../../protocol";
import { formatRemaining, useRemaining } from "../../timer";

/** Stage countdown shown to speakers. Editing the minutes takes effect on ↺. */
export function TimerControl({
  timer,
  clockOffset,
  send,
}: {
  timer: Timer;
  clockOffset: number;
  send: (msg: ClientMessage) => boolean;
}) {
  const remaining = useRemaining(timer, clockOffset) ?? timer.durationMs;
  const [minutes, setMinutes] = useState(String(Math.round(timer.durationMs / 60_000)));
  useEffect(() => setMinutes(String(Math.round(timer.durationMs / 60_000))), [timer.durationMs]);
  const running = timer.startedAt !== null;
  return (
    <div className="sc-timer-control">
      <TimerIcon size={18} aria-hidden="true" />
      <span className="sc-timer" data-over={remaining < 0 || undefined} aria-live="off">
        {formatRemaining(remaining)}
      </span>
      {running ? (
        <IconButton
          aria-label="一時停止"
          variant="secondary"
          size="sm"
          onClick={() => send({ type: "timer", action: "pause" })}
        >
          <Pause size={16} aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton
          aria-label="開始"
          variant="secondary"
          size="sm"
          onClick={() => send({ type: "timer", action: "start" })}
        >
          <Play size={16} aria-hidden="true" />
        </IconButton>
      )}
      <IconButton
        aria-label="リセット"
        variant="ghost"
        size="sm"
        onClick={() => {
          const m = Number.parseFloat(minutes);
          send({
            type: "timer",
            action: "reset",
            durationMs: Number.isFinite(m) && m > 0 ? m * 60_000 : undefined,
          });
        }}
      >
        <RotateCcw size={16} aria-hidden="true" />
      </IconButton>
      <Input
        className="sc-minutes"
        type="number"
        min={1}
        max={360}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        aria-label="分"
      />
      <span className="sc-muted">min</span>
    </div>
  );
}
