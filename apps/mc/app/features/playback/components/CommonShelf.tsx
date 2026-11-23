import { IconButton, Icons } from "@gdgjp/design-system";
import { useEffect, useRef } from "react";
import { useCatalog } from "~/features/clips/catalog-context";
import { onFrame } from "~/lib/frame";
import { primaryIntent, showsPause } from "../intent";
import { useOpenEditor } from "./ClipEditor";
import { useController } from "./controller-context";

export function CommonShelf() {
  const { catalog } = useCatalog();
  const openEditor = useOpenEditor();
  return (
    <div className="mc-shelf">
      {catalog.common.map((clip) => (
        <div key={clip.id} className="mc-chip-group">
          <ShelfChip clipId={clip.id} label={clip.title} durationMs={clip.durationMs} />
          {clip.uploaded && (
            <IconButton
              aria-label="編集"
              variant="ghost"
              size="sm"
              onClick={() => openEditor({ kind: "edit", clipId: clip.id })}
            >
              <Icons name="Pencil" size={18} aria-hidden="true" />
            </IconButton>
          )}
        </div>
      ))}
      <IconButton
        aria-label="共通の音声を追加"
        variant="outline"
        className="mc-shelf-add"
        onClick={() => openEditor({ kind: "new", track: null })}
      >
        <Icons name="Plus" size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function ShelfChip({
  clipId,
  label,
  durationMs,
}: { clipId: string; label: string; durationMs: number }) {
  const { now, run, busy, positionOf } = useController();
  const ref = useRef<HTMLButtonElement>(null);
  const current = now.clipId === clipId;
  const pause = showsPause(clipId, now);
  const key = `${clipId}:primary`;

  useEffect(() => {
    if (!current) {
      ref.current?.style.setProperty("--p", "0");
      return;
    }
    return onFrame((t) => {
      const p = durationMs > 0 ? Math.min(1, positionOf(clipId, t) / durationMs) : 0;
      ref.current?.style.setProperty("--p", p.toFixed(4));
    });
  }, [current, clipId, durationMs, positionOf]);

  return (
    <button
      ref={ref}
      type="button"
      className="mc-chip"
      data-current={current || undefined}
      aria-busy={busy.has(key) || undefined}
      onClick={() => run(key, primaryIntent(clipId, 0, now))}
    >
      <span className="mc-chip-fill" aria-hidden="true" />
      {pause ? (
        <Icons name="Pause" size={18} aria-hidden="true" />
      ) : (
        <Icons name="Play" size={18} aria-hidden="true" />
      )}
      <span className="mc-chip-label">{label}</span>
    </button>
  );
}
