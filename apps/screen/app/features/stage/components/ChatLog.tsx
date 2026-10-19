import { IconButton, Input } from "@gdgjp/design-system";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { SendHorizontal, StickyNote } from "~/components/icons";
import type { Message } from "../protocol";

function time(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Chat + cue history, newest at the bottom, with a one-line composer. */
export function ChatLog({
  messages,
  selfId,
  onSend,
  sendLabel,
  placeholder,
  nameOf,
}: {
  messages: Message[];
  selfId: string;
  onSend: (text: string) => boolean;
  sendLabel: string;
  placeholder?: string;
  /** Recipient label for operator views ("→ 山田"). */
  nameOf?: (id: string) => string | undefined;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const count = messages.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && onSend(text)) setText("");
  };
  return (
    <div className="sc-chat">
      <ol className="sc-chat-list" ref={listRef}>
        {messages.map((m) => (
          <li
            key={m.id}
            className="sc-chat-item"
            data-mine={m.from.id === selfId || undefined}
            data-cue={m.kind === "cue" || undefined}
          >
            <span className="sc-chat-meta">
              {m.kind === "cue" && <StickyNote size={12} aria-label="カンペ" />}
              {m.from.name}
              {m.to && nameOf ? ` → ${nameOf(m.to) ?? "?"}` : ""}
              <time>{time(m.at)}</time>
            </span>
            <span className="sc-chat-text">{m.text}</span>
          </li>
        ))}
      </ol>
      <form className="sc-chat-form" onSubmit={submit}>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={placeholder}
          aria-label={sendLabel}
        />
        <IconButton type="submit" aria-label={sendLabel} disabled={!text.trim()}>
          <SendHorizontal size={16} aria-hidden="true" />
        </IconButton>
      </form>
    </div>
  );
}
