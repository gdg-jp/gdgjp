import { Icons } from "@gdgjp/design-system";
import type { CSSProperties } from "react";
import { keyIcon } from "../icons";
import type { Key, KeyLook } from "../model";

export function imageUrl(deckId: string, imageId: string): string {
  return `/images/${deckId}/${imageId}`;
}

/**
 * What a key looks like: background colour, icon or uploaded image, title and
 * an optional live badge (timer, dB). `on` switches to the key's "on" look,
 * or rings the key when it has none.
 */
export function KeyFace({
  deckId,
  keyDef,
  on,
  badge,
  progress,
  armed,
}: {
  deckId: string;
  keyDef: Key;
  on: boolean | null;
  badge?: string | null;
  /** Hold-to-confirm progress 0–1. */
  progress?: number;
  /** Double-tap: waiting for the second tap. */
  armed?: boolean;
}) {
  const look: KeyLook = on && keyDef.lookOn ? keyDef.lookOn : keyDef.look;
  const icon = keyIcon(look.icon);
  return (
    <span
      className="dk-face"
      data-color={look.color}
      data-on={on || undefined}
      data-ring={(on && !keyDef.lookOn) || undefined}
      data-armed={armed || undefined}
      style={progress ? ({ "--dk-progress": progress } as CSSProperties) : undefined}
    >
      {look.image ? (
        <img
          className="dk-face-image"
          src={imageUrl(deckId, look.image)}
          alt=""
          draggable={false}
        />
      ) : icon ? (
        <Icons
          name={icon}
          size={28}
          animateOnHover={false}
          aria-hidden="true"
          className="dk-face-icon"
        />
      ) : null}
      {keyDef.title && <span className="dk-face-title">{keyDef.title}</span>}
      {badge && <span className="dk-face-badge">{badge}</span>}
      {armed && <span className="dk-face-armed">もう一度</span>}
      {progress ? <span className="dk-face-progress" aria-hidden="true" /> : null}
    </span>
  );
}
