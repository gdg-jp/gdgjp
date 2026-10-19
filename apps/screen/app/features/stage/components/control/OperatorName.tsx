import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@gdgjp/design-system";
import { type FormEvent, useEffect, useState } from "react";
import { Pencil } from "~/components/icons";
import { type ClientMessage, MAX_NAME_LENGTH } from "../../protocol";
import type { SocketStatus } from "../../reliable-socket";

const NAME_KEY = "screen-op-name";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The name speakers see for this operator (chat, cues, "talking" indicator).
 * Defaults to the account name; an edited name is remembered in this browser
 * and re-announced on every (re)connect, since the room forgets operators
 * when they disconnect.
 */
export function OperatorName({
  current,
  socketStatus,
  send,
}: {
  current: string | null;
  socketStatus: SocketStatus;
  send: (msg: ClientMessage) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const name = savedName();
    if (socketStatus === "open" && name && current !== null && name !== current) {
      send({ type: "name", name });
    }
  }, [socketStatus, current, send]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // private mode: still applies for this connection
    }
    send({ type: "name", name });
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(current ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="sc-op-name" title="登壇者に表示される名前">
          <span>{current ?? "…"}</span>
          <Pencil size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="sc-op-name-form">
        <form onSubmit={submit}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            aria-label="登壇者に表示される名前"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            保存
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
