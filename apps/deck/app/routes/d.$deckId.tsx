import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Icons,
  Slider,
  toast,
} from "@gdgjp/design-system";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { requireDeck } from "~/features/deck/access.server";
import { ControllerKey } from "~/features/deck/components/ControllerKey";
import { formatDb, keyBadge, keyIsOn } from "~/features/deck/key-state";
import { type Board, type Key, ROOT_BOARD } from "~/features/deck/model";
import { VOLUME_MAX_DB, VOLUME_MIN_DB, actionVolumeDb } from "~/features/obs/actions";
import { CLOSE_DELETED } from "~/features/room/protocol";
import { type DeckRoomState, useDeckRoom } from "~/features/room/use-deck-room";
import { useWakeLock } from "~/lib/wake-lock";
import type { Route } from "./+types/d.$deckId";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.name} — deck` : "deck" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { deck } = await requireDeck(context.cloudflare.env, request, params.deckId);
  return { deckId: deck.id, name: deck.name };
}

type Nav = { stack: string[]; page: Record<string, number> };

function useNow(active: boolean, offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [active, offset]);
  return now;
}

function StatusChips({ room, online }: { room: DeckRoomState | null; online: boolean }) {
  if (!online || !room)
    return (
      <span className="dk-chip" data-tone="down">
        オフライン
      </span>
    );
  if (!room.dockOnline)
    return (
      <span className="dk-chip" data-tone="down">
        ドック未接続
      </span>
    );
  if (!room.obs.connected)
    return (
      <span className="dk-chip" data-tone="warn">
        OBS 未接続
      </span>
    );
  return (
    <span className="dk-chip-group">
      {room.obs.streaming && (
        <span className="dk-chip" data-tone="live">
          配信
        </span>
      )}
      {room.obs.recording && (
        <span className="dk-chip" data-tone="live">
          {room.obs.recordPaused ? "録画 ❚❚" : "録画"}
        </span>
      )}
      {!room.obs.streaming && !room.obs.recording && (
        <span className="dk-chip" data-tone="ok">
          接続中
        </span>
      )}
    </span>
  );
}

export default function Controller({ loaderData }: Route.ComponentProps) {
  const { deckId } = loaderData;
  const { room, status, rejected, clockOffset, send } = useDeckRoom(deckId);
  const [nav, setNav] = useState<Nav>({ stack: [ROOT_BOARD], page: {} });
  const [sliderKey, setSliderKey] = useState<Key | null>(null);
  const pressedAt = useRef(new Map<string, number>());
  const seenErrors = useRef(new Set<string>());
  useWakeLock();

  const online = status === "open";
  const obs = room?.obs;
  const now = useNow(!!(obs?.streaming || obs?.recording), clockOffset);

  // Errors for keys this phone pressed in the last 10 s show as a toast.
  useEffect(() => {
    if (!room) return;
    for (const entry of room.log) {
      if (entry.status !== "error" || seenErrors.current.has(entry.id)) continue;
      seenErrors.current.add(entry.id);
      const at = pressedAt.current.get(entry.keyId);
      if (at && Date.now() - at < 10_000) toast.error(entry.error ?? "失敗しました");
    }
  }, [room]);

  const layout = room?.layout;
  const boardId = nav.stack[nav.stack.length - 1] ?? ROOT_BOARD;
  const board: Board | undefined = layout?.boards[boardId] ?? layout?.boards[ROOT_BOARD];
  const pageCount = board?.pages.length ?? 1;
  const pageIndex = Math.min(nav.page[board?.id ?? ROOT_BOARD] ?? 0, pageCount - 1);
  const page = board?.pages[pageIndex];

  // A folder deleted by an editor: fall back to the root.
  useEffect(() => {
    if (layout && !layout.boards[boardId]) setNav({ stack: [ROOT_BOARD], page: {} });
  }, [layout, boardId]);

  const setPage = (index: number) => {
    if (!board) return;
    const next = ((index % pageCount) + pageCount) % pageCount;
    setNav((n) => ({ ...n, page: { ...n.page, [board.id]: next } }));
  };

  const navigate = (key: Key) => {
    const b = key.behavior;
    if (b.type === "folder" && layout?.boards[b.board]) {
      setNav((n) => ({ ...n, stack: [...n.stack, b.board] }));
    } else if (b.type === "back") {
      setNav((n) => ({ ...n, stack: n.stack.length > 1 ? n.stack.slice(0, -1) : n.stack }));
    } else if (b.type === "page") {
      setPage(b.to === "next" ? pageIndex + 1 : b.to === "prev" ? pageIndex - 1 : b.to);
    }
  };

  const slots = useMemo(() => {
    if (!layout) return [];
    return Array.from(
      { length: layout.cols * layout.rows },
      (_, i) => page?.keys[String(i)] ?? null,
    );
  }, [layout, page]);

  if (rejected === CLOSE_DELETED) {
    return (
      <main className="dk-error">
        <p>このデッキは削除されました</p>
        <Link to="/">デッキ一覧へ</Link>
      </main>
    );
  }

  const disabled = !online || !room?.dockOnline || !room.obs.connected;
  // Folders get a "back" key by default; offer one on the phone only if it was removed.
  const needsBack =
    nav.stack.length > 1 &&
    !Object.values(page?.keys ?? {}).some((k) => k.behavior.type === "back");
  const cols = layout?.cols ?? 1;
  const rows = layout?.rows ?? 1;
  // Phones reflow the keys in reading order to the screen's orientation (see app.css).
  const gridVars = {
    "--dk-cols": cols,
    "--dk-rows": rows,
    "--dk-tall-cols": Math.min(cols, rows),
    "--dk-tall-rows": Math.max(cols, rows),
    "--dk-wide-cols": Math.max(cols, rows),
    "--dk-wide-rows": Math.min(cols, rows),
  } as CSSProperties;

  return (
    <div className="dk-controller">
      <header className="dk-controller-head">
        {nav.stack.length > 1 ? (
          <IconButton
            aria-label="戻る"
            variant="ghost"
            size="sm"
            onClick={() => setNav((n) => ({ ...n, stack: n.stack.slice(0, -1) }))}
          >
            <Icons name="ChevronLeft" size={20} aria-hidden="true" animateOnHover={false} />
          </IconButton>
        ) : (
          <IconButton asChild aria-label="デッキ一覧" variant="ghost" size="sm">
            <Link to="/">
              <Icons name="LayoutGrid" size={18} aria-hidden="true" animateOnHover={false} />
            </Link>
          </IconButton>
        )}
        <span className="dk-controller-name">
          {room?.deck.name ?? loaderData.name}
          {board && board.id !== ROOT_BOARD && <span className="dk-muted"> / {board.name}</span>}
        </span>
        <span className="dk-spacer" />
        <StatusChips room={room} online={online} />
      </header>

      {/* Phones hide the header: only problems and a missing way back are shown, over the keys. */}
      <div className="dk-float">
        {needsBack && (
          <IconButton
            aria-label="戻る"
            variant="secondary"
            size="sm"
            onClick={() => setNav((n) => ({ ...n, stack: n.stack.slice(0, -1) }))}
          >
            <Icons name="ChevronLeft" size={18} aria-hidden="true" animateOnHover={false} />
          </IconButton>
        )}
        <span className="dk-spacer" />
        {disabled && <StatusChips room={room} online={online} />}
      </div>

      <main className="dk-controller-main">
        {layout ? (
          <div className="dk-grid" style={gridVars}>
            {slots.map((key, i) =>
              key ? (
                <ControllerKey
                  key={`${page?.id}-${i}`}
                  deckId={deckId}
                  keyDef={key}
                  on={obs ? keyIsOn(key, obs, room?.switches ?? {}) : null}
                  badge={obs ? keyBadge(key, obs, now) : null}
                  disabled={disabled}
                  onPress={(phase) => {
                    pressedAt.current.set(key.id, Date.now());
                    if (!send({ type: "press", keyId: key.id, phase }))
                      toast.error("接続が切れています");
                  }}
                  onNavigate={() => navigate(key)}
                  onSlider={() => setSliderKey(key)}
                />
              ) : (
                <span key={`${page?.id}-${i}`} className="dk-key dk-key-empty" aria-hidden="true" />
              ),
            )}
          </div>
        ) : (
          <p className="dk-muted dk-loading">接続しています…</p>
        )}
      </main>

      {pageCount > 1 && (
        <nav className="dk-pages" aria-label="ページ">
          <IconButton
            aria-label="前のページ"
            variant="ghost"
            size="sm"
            onClick={() => setPage(pageIndex - 1)}
          >
            <Icons name="ChevronLeft" size={18} aria-hidden="true" animateOnHover={false} />
          </IconButton>
          {board?.pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="dk-page-dot"
              aria-label={`${i + 1} ページ`}
              aria-current={i === pageIndex ? "page" : undefined}
              onClick={() => setPage(i)}
            />
          ))}
          <IconButton
            aria-label="次のページ"
            variant="ghost"
            size="sm"
            onClick={() => setPage(pageIndex + 1)}
          >
            <Icons name="ChevronRight" size={18} aria-hidden="true" animateOnHover={false} />
          </IconButton>
        </nav>
      )}

      <VolumeDialog
        keyDef={sliderKey}
        room={room}
        onClose={() => setSliderKey(null)}
        onChange={(db) => {
          if (sliderKey) send({ type: "volume", keyId: sliderKey.id, db });
        }}
      />
    </div>
  );
}

const SLIDER_SEND_MS = 80;

function VolumeDialog({
  keyDef,
  room,
  onClose,
  onChange,
}: {
  keyDef: Key | null;
  room: DeckRoomState | null;
  onClose: () => void;
  onChange: (db: number) => void;
}) {
  const action = keyDef?.behavior.type === "action" ? keyDef.behavior.action : null;
  const live = action && room ? actionVolumeDb(action, room.obs) : null;
  const [value, setValue] = useState<number | null>(null);
  const lastSent = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!keyDef) setValue(null);
  }, [keyDef]);

  const shown = value ?? Math.max(VOLUME_MIN_DB, live ?? VOLUME_MIN_DB);

  // Throttle while dragging; always send the final value.
  const push = (db: number) => {
    clearTimeout(pending.current);
    const wait = SLIDER_SEND_MS - (Date.now() - lastSent.current);
    if (wait <= 0) {
      lastSent.current = Date.now();
      onChange(db);
    } else {
      pending.current = setTimeout(() => {
        lastSent.current = Date.now();
        onChange(db);
      }, wait);
    }
  };

  const inputName = action && "input" in action ? action.input.name : "";

  return (
    <Dialog open={!!keyDef} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dk-dialog">
        <DialogTitle>{keyDef?.title || inputName || "音量"}</DialogTitle>
        <DialogDescription>{inputName}</DialogDescription>
        <div className="dk-volume">
          <Slider
            aria-label="音量"
            min={VOLUME_MIN_DB}
            max={VOLUME_MAX_DB}
            step={0.5}
            value={[shown]}
            onValueChange={([db]) => {
              if (db === undefined) return;
              setValue(db);
              push(db);
            }}
          />
          <span className="dk-volume-value">{formatDb(shown)}</span>
        </div>
        <div className="dk-dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
