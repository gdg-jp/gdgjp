import { IconButton, Icons } from "@gdgjp/design-system";
import { memo, useCallback, useRef } from "react";
import type { Clip } from "~/features/clips/catalog";
import { primaryIntent, restartIntent, seekIntent, showsPause } from "../intent";
import { useOpenEditor } from "./ClipEditor";
import { RemainingTime } from "./RemainingTime";
import { ScrollingText } from "./ScrollingText";
import { SeekBar } from "./SeekBar";
import { useController } from "./controller-context";

export function useClipClock(clipId: string) {
  const { positionOf } = useController();
  const preview = useRef<number | null>(null);
  const getMs = useCallback(
    (now: number) => preview.current ?? positionOf(clipId, now),
    [clipId, positionOf],
  );
  const setPreview = useCallback((ms: number | null) => {
    preview.current = ms;
  }, []);
  return { getMs, setPreview };
}

export const ClipCard = memo(function ClipCard({ clip }: { clip: Clip }) {
  const { now, cues, setCue, busy, run, room, setPlayed } = useController();
  const { getMs, setPreview } = useClipClock(clip.id);
  const openEditor = useOpenEditor();
  const current = now.clipId === clip.id;
  const pause = showsPause(clip.id, now);
  const played = Boolean(room.config.played[clip.id]);
  const primaryKey = `${clip.id}:primary`;
  const restartKey = `${clip.id}:restart`;

  const onCommit = async (ms: number) => {
    if (!current || now.status === "idle") {
      setCue(clip.id, ms);
      return;
    }
    setPreview(ms);
    await run(`${clip.id}:seek`, seekIntent(ms, now));
    setPreview(null);
  };

  return (
    <article
      className="mc-card"
      data-current={current || undefined}
      data-status={current ? now.status : undefined}
    >
      <div className="mc-card-controls">
        <IconButton
          aria-label="最初から再生"
          variant="ghost"
          disabled={!current}
          loading={busy.has(restartKey)}
          onClick={() => run(restartKey, restartIntent(now))}
        >
          <Icons name="ChevronFirst" size={18} aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label={pause ? "停止" : "再生"}
          variant={current ? "primary" : "outline"}
          className="mc-play"
          loading={busy.has(primaryKey)}
          onClick={() => run(primaryKey, primaryIntent(clip.id, cues[clip.id] ?? 0, now))}
        >
          {pause ? (
            <Icons name="Pause" size={18} aria-hidden="true" />
          ) : (
            <Icons name="Play" size={18} aria-hidden="true" />
          )}
        </IconButton>
      </div>
      <div className="mc-card-body">
        <ScrollingText
          className="mc-card-text"
          segments={clip.segments}
          durationMs={clip.durationMs}
          getMs={getMs}
        />
        <div className="mc-card-meta">
          <span className="mc-card-title">{clip.title}</span>
          <span className="mc-card-file">{clip.file}</span>
          <RemainingTime
            className="mc-card-duration"
            durationMs={clip.durationMs}
            getMs={getMs}
            live={current}
          />
          {clip.uploaded && (
            <IconButton
              aria-label="編集"
              variant="ghost"
              size="sm"
              className="mc-card-edit"
              onClick={() => openEditor({ kind: "edit", clipId: clip.id })}
            >
              <Icons name="Pencil" size={18} aria-hidden="true" />
            </IconButton>
          )}
        </div>
        <SeekBar
          durationMs={clip.durationMs}
          getMs={getMs}
          onScrub={setPreview}
          onCommit={onCommit}
          active={current}
          label={clip.title}
        />
      </div>
      {clip.track !== null && (
        <button
          type="button"
          className="mc-played"
          aria-pressed={played}
          aria-label="再生済み"
          onClick={() => setPlayed(clip.id, !played)}
        >
          <Icons name="Check" size={18} aria-hidden="true" />
        </button>
      )}
    </article>
  );
});
