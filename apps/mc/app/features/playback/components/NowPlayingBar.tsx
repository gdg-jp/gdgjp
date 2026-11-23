import {
  IconButton,
  Icons,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@gdgjp/design-system";
import { useEffect, useRef } from "react";
import type { Clip } from "~/features/clips/catalog";
import { useCatalog } from "~/features/clips/catalog-context";
import { onFrame } from "~/lib/frame";
import { primaryIntent, restartIntent, seekIntent, showsPause } from "../intent";
import { MAX_LOOP_GAP_SEC } from "../protocol";
import { useClipClock } from "./ClipCard";
import { ScrollingText } from "./ScrollingText";
import { SeekBar } from "./SeekBar";
import { useController } from "./controller-context";

export function NowPlayingBar() {
  const { now } = useController();
  const { catalog } = useCatalog();
  const clip = catalog.get(now.clipId);
  return (
    <div className="mc-bar-dock" data-visible={clip ? true : undefined}>
      {clip && <Bar key={clip.id} clip={clip} />}
    </div>
  );
}

function Bar({ clip }: { clip: Clip }) {
  const { now, run, busy } = useController();
  const { getMs, setPreview } = useClipClock(clip.id);
  const pause = showsPause(clip.id, now);

  const onCommit = async (ms: number) => {
    setPreview(ms);
    await run("bar:seek", seekIntent(ms, now));
    setPreview(null);
  };

  return (
    <section className="mc-bar" data-status={now.status} aria-label="再生中">
      <div className="mc-bar-controls">
        <IconButton
          aria-label="最初から再生"
          variant="ghost"
          loading={busy.has("bar:restart")}
          onClick={() => run("bar:restart", restartIntent(now))}
        >
          <Icons name="ChevronFirst" size={18} aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={pause ? "停止" : "再生"}
          variant="primary"
          size="lg"
          className="mc-play"
          loading={busy.has("bar:primary")}
          onClick={() => run("bar:primary", primaryIntent(clip.id, 0, now))}
        >
          {pause ? (
            <Icons name="Pause" size={18} aria-hidden="true" />
          ) : (
            <Icons name="Play" size={18} aria-hidden="true" />
          )}
        </IconButton>
      </div>
      <div className="mc-bar-body">
        <ScrollingText
          className="mc-bar-text"
          segments={clip.segments}
          durationMs={clip.durationMs}
          getMs={getMs}
        />
        <div className="mc-card-meta">
          {clip.track && <span className="mc-bar-track">{clip.track}</span>}
          <span className="mc-card-title">{clip.title}</span>
          <span className="mc-card-file">{clip.file}</span>
        </div>
        <SeekBar
          durationMs={clip.durationMs}
          getMs={getMs}
          onScrub={setPreview}
          onCommit={onCommit}
          active
          label={clip.title}
          showTimes
        />
      </div>
      <LoopControl clip={clip} />
      <GapCountdown />
    </section>
  );
}

function LoopControl({ clip }: { clip: Clip }) {
  const { loopOf, setLoop } = useController();
  const loop = loopOf(clip);
  const setGap = (gapSec: number) =>
    setLoop(clip.id, {
      ...loop,
      gapSec: Math.min(MAX_LOOP_GAP_SEC, Math.max(0, Math.round(gapSec) || 0)),
    });

  return (
    <div className="mc-loop">
      <IconButton
        aria-label="ループ"
        aria-pressed={loop.enabled}
        variant="ghost"
        className="mc-toggle"
        onClick={() => setLoop(clip.id, { ...loop, enabled: !loop.enabled })}
      >
        <Icons name="RefreshCw" size={18} aria-hidden="true" />
      </IconButton>
      <Popover>
        <PopoverTrigger asChild>
          <IconButton
            aria-label="ループ間隔"
            variant="ghost"
            size="sm"
            className="mc-loop-gap"
            data-set={loop.gapSec > 0 || undefined}
          >
            <Icons name="Timer" size={18} aria-hidden="true" />
            {loop.gapSec > 0 && <span className="mc-loop-gap-value">{loop.gapSec}</span>}
          </IconButton>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="mc-gap-popover">
          <IconButton
            aria-label="短く"
            variant="ghost"
            size="sm"
            onClick={() => setGap(loop.gapSec - 5)}
          >
            <Icons name="ChevronLeft" size={18} aria-hidden="true" />
          </IconButton>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_LOOP_GAP_SEC}
            step={1}
            aria-label="ループ間隔（秒）"
            className="mc-gap-input"
            value={loop.gapSec}
            onChange={(e) => setGap(Number(e.currentTarget.value))}
          />
          <span className="mc-gap-unit">秒</span>
          <IconButton
            aria-label="長く"
            variant="ghost"
            size="sm"
            onClick={() => setGap(loop.gapSec + 5)}
          >
            <Icons name="ChevronRight" size={18} aria-hidden="true" />
          </IconButton>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function GapCountdown() {
  const { now, primaryRef } = useController();
  const ref = useRef<HTMLSpanElement>(null);
  const waiting = now.status === "gap";
  useEffect(() => {
    if (!waiting) return;
    return onFrame((t) => {
      const p = primaryRef.current;
      const s = p?.state;
      if (!ref.current || !s) return;
      const left = Math.max(0, s.gapRemainingMs - (t - p.receivedAt));
      ref.current.textContent = `${Math.ceil(left / 1000)}`;
    });
  }, [waiting, primaryRef]);
  if (!waiting) return null;
  return (
    <span className="mc-gap-countdown" aria-live="polite">
      <Icons name="Timer" size={18} aria-hidden="true" />
      <span ref={ref} />
    </span>
  );
}
