import {
  Alert,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Icons,
  Input,
  toast,
} from "@gdgjp/design-system";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Choice } from "~/components/Choice";
import { requireDeck } from "~/features/deck/access.server";
import {
  DeleteDeckDialog,
  DockUrlDialog,
  DuplicateDeckDialog,
  RenameDeckDialog,
} from "~/features/deck/components/DeckDialogs";
import { KeyFace } from "~/features/deck/components/KeyFace";
import { KeyInspector } from "~/features/deck/components/KeyInspector";
import {
  addFolder,
  addPage,
  droppedByResize,
  incompleteKeys,
  keyIsIncomplete,
  moveKey,
  movePage,
  newKey,
  removeBoard,
  removePage,
  renameBoard,
  resize,
  setKey,
} from "~/features/deck/editing";
import { keyBadge, keyIsOn } from "~/features/deck/key-state";
import { type DeckLayout, type Key, MAX_COLS, MAX_ROWS, ROOT_BOARD } from "~/features/deck/model";
import { defaultAction } from "~/features/obs/actions";
import type { LogEntry } from "~/features/room/protocol";
import { useDeckRoom } from "~/features/room/use-deck-room";
import { TopBar } from "~/layouts/TopBar";
import type { Route } from "./+types/decks.$deckId.edit";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.deck.name} を編集 — deck` : "deck" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters, deck } = await requireDeck(env, request, params.deckId);
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters: chapters.map((c) => ({ chapterId: c.chapterId, chapterSlug: c.chapterSlug })),
    deck: {
      id: deck.id,
      name: deck.name,
      chapterId: deck.chapterId,
      version: deck.version,
      layout: deck.layout,
      dockToken: deck.dockToken,
    },
  };
}

type Dialog = "rename" | "dock" | "duplicate" | "delete" | null;

export default function Editor({ loaderData }: Route.ComponentProps) {
  const { deck, chapters, user, accountsUrl } = loaderData;
  const { room, status, send } = useDeckRoom(deck.id);
  const [draft, setDraft] = useState<DeckLayout>(deck.layout);
  const [baseVersion, setBaseVersion] = useState(deck.version);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [boardId, setBoardId] = useState(ROOT_BOARD);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const closeDialog = useCallback((open: boolean) => !open && setDialog(null), []);

  const obs = room?.dockOnline ? room.obs : null;
  const name = room?.deck.name ?? deck.name;

  // Someone else saved: adopt it when nothing is pending here, otherwise warn.
  useEffect(() => {
    if (!room || room.deck.version <= baseVersion) return;
    if (dirty) {
      setStale(true);
    } else {
      setDraft(room.layout);
      setBaseVersion(room.deck.version);
    }
  }, [room, baseVersion, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = (next: DeckLayout) => {
    setDraft(next);
    setDirty(true);
  };

  const board = draft.boards[boardId] ?? draft.boards[ROOT_BOARD];
  const page = board?.pages[Math.min(pageIndex, (board?.pages.length ?? 1) - 1)];
  const currentPage = board ? Math.min(pageIndex, board.pages.length - 1) : 0;
  const selectedKey = selected === null ? null : (page?.keys[String(selected)] ?? null);
  const incomplete = useMemo(() => incompleteKeys(draft), [draft]);

  const save = async () => {
    if (incomplete.length > 0) {
      toast.error(`設定が足りないキーが ${incomplete.length} 個あります（赤い印）`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/decks/${deck.id}/layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: baseVersion, layout: draft }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok: boolean;
        version?: number;
        error?: string;
      } | null;
      if (res.status === 409) {
        setStale(true);
        toast.error("ほかの人が先に保存しました");
        return;
      }
      if (!res.ok || !json?.ok || !json.version) {
        toast.error(json?.error === "too-large" ? "デッキが大きすぎます" : "保存できませんでした");
        return;
      }
      setBaseVersion(json.version);
      setDirty(false);
      setStale(false);
      toast.success("保存しました");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!room) return;
    setDraft(room.layout);
    setBaseVersion(room.deck.version);
    setDirty(false);
    setStale(false);
    setSelected(null);
  };

  const updateKey = (key: Key | null) => {
    if (selected === null || !board) return;
    edit(setKey(draft, board.id, currentPage, selected, key));
    if (!key) setSelected(null);
  };

  const onSlotClick = (slot: number) => {
    if (!board) return;
    if (!page?.keys[String(slot)]) {
      edit(
        setKey(
          draft,
          board.id,
          currentPage,
          slot,
          newKey({ type: "action", action: defaultAction("scene") }),
        ),
      );
    }
    setSelected(slot);
  };

  const switchBoard = (id: string) => {
    setBoardId(id);
    setPageIndex(0);
    setSelected(null);
  };

  const folders = Object.values(draft.boards).filter((b) => b.id !== ROOT_BOARD);
  const slots = draft.cols * draft.rows;

  return (
    <div className="dk-page dk-editor-page">
      <TopBar user={user} accountsUrl={accountsUrl}>
        <Link to="/" className="dk-brand">
          deck
        </Link>
        <span className="dk-muted">/</span>
        <span className="dk-editor-name">{name}</span>
        {dirty && (
          <span className="dk-chip" data-tone="warn">
            未保存
          </span>
        )}
        <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>
          保存
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`/d/${deck.id}`} target="_blank">
            操作画面
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="デッキのメニュー" variant="ghost" size="sm">
              <Icons name="MoreHorizontal" size={18} animateOnHover={false} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog("dock")}>OBS のドック URL</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("rename")}>名前を変更</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("duplicate")}>複製</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="dk-danger-item" onSelect={() => setDialog("delete")}>
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TopBar>

      {stale && (
        <Alert
          tone="warning"
          title="ほかの人がこのデッキを保存しました"
          className="dk-editor-alert"
        >
          <span className="dk-alert-body">
            このまま保存すると相手の変更が消えるため、保存できません。
            <Button size="sm" variant="outline" onClick={discard}>
              自分の変更を捨てて最新を読み込む
            </Button>
          </span>
        </Alert>
      )}

      <div className="dk-editor">
        <section className="dk-editor-main">
          <div className="dk-toolbar">
            <Choice
              aria-label="画面"
              value={board?.id ?? ROOT_BOARD}
              onChange={switchBoard}
              className="dk-board-select"
              options={[
                { value: ROOT_BOARD, label: "ホーム" },
                ...folders.map((f) => ({ value: f.id, label: `フォルダ: ${f.name}` })),
              ]}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const res = addFolder(draft, "フォルダ");
                if (!res) return;
                edit(res.layout);
                switchBoard(res.boardId);
              }}
            >
              フォルダを追加
            </Button>
            {board && board.id !== ROOT_BOARD && (
              <>
                <Input
                  aria-label="フォルダ名"
                  className="dk-board-name"
                  value={board.name}
                  maxLength={40}
                  onChange={(e) => edit(renameBoard(draft, board.id, e.currentTarget.value))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    edit(removeBoard(draft, board.id));
                    switchBoard(ROOT_BOARD);
                  }}
                >
                  フォルダを削除
                </Button>
              </>
            )}
            <span className="dk-spacer" />
            <GridSize
              layout={draft}
              onResize={(cols, rows) => {
                const lost = droppedByResize(draft, cols, rows);
                if (
                  lost > 0 &&
                  !window.confirm(`はみ出すキーが ${lost} 個削除されます。続けますか？`)
                )
                  return;
                edit(resize(draft, cols, rows));
                setSelected(null);
              }}
            />
          </div>

          <div className="dk-page-tabs" role="tablist" aria-label="ページ">
            {board?.pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={i === currentPage}
                className="dk-page-tab"
                onClick={() => {
                  setPageIndex(i);
                  setSelected(null);
                }}
              >
                {i + 1}
              </button>
            ))}
            <IconButton
              aria-label="ページを追加"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!board) return;
                edit(addPage(draft, board.id));
                setPageIndex(board.pages.length);
                setSelected(null);
              }}
            >
              <Icons name="Plus" size={16} animateOnHover={false} aria-hidden="true" />
            </IconButton>
            {board && board.pages.length > 1 && (
              <>
                <IconButton
                  aria-label="ページを左へ"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    edit(movePage(draft, board.id, currentPage, currentPage - 1));
                    setPageIndex(Math.max(0, currentPage - 1));
                  }}
                >
                  <Icons name="ChevronLeft" size={16} animateOnHover={false} aria-hidden="true" />
                </IconButton>
                <IconButton
                  aria-label="ページを右へ"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    edit(movePage(draft, board.id, currentPage, currentPage + 1));
                    setPageIndex(Math.min(board.pages.length - 1, currentPage + 1));
                  }}
                >
                  <Icons name="ChevronRight" size={16} animateOnHover={false} aria-hidden="true" />
                </IconButton>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (
                      Object.keys(page?.keys ?? {}).length > 0 &&
                      !window.confirm("このページのキーも削除されます。続けますか？")
                    ) {
                      return;
                    }
                    edit(removePage(draft, board.id, currentPage));
                    setPageIndex(Math.max(0, currentPage - 1));
                    setSelected(null);
                  }}
                >
                  ページを削除
                </Button>
              </>
            )}
          </div>

          <div
            className="dk-grid dk-editor-grid"
            style={{ "--dk-cols": draft.cols, "--dk-rows": draft.rows } as CSSProperties}
          >
            {Array.from({ length: slots }, (_, slot) => {
              const key = page?.keys[String(slot)];
              return (
                <button
                  key={`${page?.id}-${slot}`}
                  type="button"
                  className={key ? "dk-key" : "dk-key dk-key-empty dk-key-add"}
                  aria-label={
                    key ? `キー: ${key.title || "（無題）"}` : `空き ${slot + 1} にキーを追加`
                  }
                  aria-pressed={selected === slot}
                  data-selected={selected === slot || undefined}
                  data-incomplete={(key && keyIsIncomplete(key)) || undefined}
                  draggable={!!key}
                  onDragStart={(e) => {
                    setDragFrom(slot);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragFrom(null)}
                  onDragOver={(e) => {
                    if (dragFrom !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom === null || !board) return;
                    edit(moveKey(draft, board.id, currentPage, dragFrom, slot));
                    setSelected(slot);
                    setDragFrom(null);
                  }}
                  onClick={() => onSlotClick(slot)}
                >
                  {key ? (
                    <KeyFace
                      deckId={deck.id}
                      keyDef={key}
                      on={obs ? keyIsOn(key, obs, room?.switches ?? {}) : null}
                      badge={obs ? keyBadge(key, obs, Date.now()) : null}
                    />
                  ) : (
                    <Icons name="Plus" size={18} animateOnHover={false} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
          <p className="dk-help">
            空きをクリックするとキーを追加します。キーはドラッグで並べ替えられます。
          </p>

          <DockPanel status={status} room={room} onRefresh={() => send({ type: "refresh" })} />
        </section>

        <aside className="dk-editor-side">
          {selectedKey ? (
            <KeyInspector
              key={selectedKey.id}
              deckId={deck.id}
              layout={draft}
              keyDef={selectedKey}
              obs={obs}
              on={obs ? keyIsOn(selectedKey, obs, room?.switches ?? {}) : null}
              onChange={(k) => updateKey(k)}
              onDelete={() => updateKey(null)}
            />
          ) : (
            <p className="dk-muted dk-inspector-empty">キーを選ぶと、ここで設定できます。</p>
          )}
        </aside>
      </div>

      <RenameDeckDialog
        deckId={deck.id}
        deckName={name}
        open={dialog === "rename"}
        onOpenChange={closeDialog}
      />
      <DockUrlDialog
        deckId={deck.id}
        token={deck.dockToken}
        open={dialog === "dock"}
        onOpenChange={closeDialog}
      />
      <DuplicateDeckDialog
        deckId={deck.id}
        deckName={name}
        chapterId={deck.chapterId}
        chapters={chapters}
        open={dialog === "duplicate"}
        onOpenChange={closeDialog}
      />
      <DeleteDeckDialog
        deckId={deck.id}
        deckName={name}
        open={dialog === "delete"}
        onOpenChange={closeDialog}
      />
    </div>
  );
}

function GridSize({
  layout,
  onResize,
}: { layout: DeckLayout; onResize: (cols: number, rows: number) => void }) {
  return (
    <span className="dk-grid-size">
      <span className="dk-grid-size-field">
        <span aria-hidden="true">列</span>
        <Choice
          aria-label="列"
          value={String(layout.cols)}
          onChange={(v) => onResize(Number(v), layout.rows)}
          options={Array.from({ length: MAX_COLS }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
        />
      </span>
      <span className="dk-grid-size-field">
        <span aria-hidden="true">行</span>
        <Choice
          aria-label="行"
          value={String(layout.rows)}
          onChange={(v) => onResize(layout.cols, Number(v))}
          options={Array.from({ length: MAX_ROWS }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
        />
      </span>
    </span>
  );
}

function logStatus(e: LogEntry): string {
  return e.status === "pending" ? "実行中" : e.status === "ok" ? "成功" : "失敗";
}

function DockPanel({
  status,
  room,
  onRefresh,
}: {
  status: string;
  room: ReturnType<typeof useDeckRoom>["room"];
  onRefresh: () => void;
}) {
  const log = (room?.log ?? []).slice(-50).reverse();
  return (
    <section className="dk-dock-panel">
      <div className="dk-panel-head">
        <h2>OBS</h2>
        {status !== "open" || !room ? (
          <span className="dk-chip" data-tone="down">
            オフライン
          </span>
        ) : !room.dockOnline ? (
          <span className="dk-chip" data-tone="down">
            ドック未接続
          </span>
        ) : !room.obs.connected ? (
          <span className="dk-chip" data-tone="warn">
            OBS 未接続
          </span>
        ) : (
          <span className="dk-chip" data-tone="ok">
            OBS {room.obs.obsVersion} ・ シーン {room.obs.scenes.length}
          </span>
        )}
        <span className="dk-spacer" />
        <Button size="sm" variant="ghost" disabled={!room?.dockOnline} onClick={onRefresh}>
          OBS を読み直す
        </Button>
      </div>
      {!room?.dockOnline && (
        <p className="dk-help">
          ドックが繋がっている間は、シーンやソースを OBS の一覧から選べます。メニューの「OBS
          のドック URL」から設定します。
        </p>
      )}
      <h3 className="dk-panel-sub">操作ログ</h3>
      {log.length === 0 ? (
        <p className="dk-muted">まだ操作はありません</p>
      ) : (
        <ol className="dk-log">
          {log.map((e) => (
            <li key={e.id} data-status={e.status}>
              <time>{new Date(e.at).toLocaleTimeString("ja-JP")}</time>
              <span>{e.title || "（無題のキー）"}</span>
              <span className="dk-muted">{e.by}</span>
              <span className="dk-log-status">{logStatus(e)}</span>
              {e.error && <span className="dk-log-error">{e.error}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
