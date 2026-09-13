import EmojiPicker, { Emoji, EmojiStyle, type EmojiClickData } from "emoji-picker-react";

import { useEffect, useRef, useState } from "react";

/** Convert a raw emoji character to the unified hex string expected by the Emoji component. */
import { Icons } from "@gdgjp/ui";
function toUnified(emoji: string): string {
  return [...emoji].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join("-");
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

interface EmojiReactionBarProps {
  reactions: ReactionGroup[];
  onToggleReaction: (emoji: string) => void;
  readOnly?: boolean;
}

export default function EmojiReactionBar({
  reactions,
  onToggleReaction,
  readOnly = false,
}: EmojiReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [pickerOpen]);

  function handlePickerSelect(data: EmojiClickData) {
    onToggleReaction(data.emoji);
    setPickerOpen(false);
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggleReaction(r.emoji)}
          disabled={readOnly}
          className={[
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-sm transition-colors",
            r.reactedByMe ? "reaction-active hover:brightness-95" : "bg-neutral hover:bg-neutral",
            readOnly ? "cursor-default" : "",
          ].join(" ")}
        >
          <Emoji unified={toUnified(r.emoji)} emojiStyle={EmojiStyle.TWITTER} size={16} />
          <span
            className={[
              "text-xs font-medium",
              r.reactedByMe ? "reaction-count" : "text-muted",
            ].join(" ")}
          >
            {r.count}
          </span>
        </button>
      ))}

      {!readOnly && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="rounded-full border border-border bg-surface p-1 text-muted hover:bg-background hover:text-muted"
          aria-label="Add reaction"
        >
          <Icons name="Smile" size={15} />
        </button>
      )}

      {!readOnly && pickerOpen ? (
        <div className="absolute bottom-full left-0 z-50 mb-1">
          <div ref={pickerRef}>
            <EmojiPicker
              onEmojiClick={handlePickerSelect}
              emojiStyle={EmojiStyle.TWITTER}
              height={350}
              width={300}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
