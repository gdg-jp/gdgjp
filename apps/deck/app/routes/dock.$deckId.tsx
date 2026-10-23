import { Button, FormField, Input } from "@gdgjp/design-system";
import { useEffect, useRef, useState } from "react";
import { getDeck, isDeckId, timingSafeEqual } from "~/features/deck/decks.server";
import { DockEngine, type DockSettings, type DockSnapshot } from "~/features/dock/dock-engine";
import { OBS_DEFAULT_URL } from "~/features/obs/obs-client";
import { CLOSE_DELETED, CLOSE_REPLACED, CLOSE_REVOKED } from "~/features/room/protocol";
import type { Route } from "./+types/dock.$deckId";

export function meta() {
  return [{ title: "deck ドック" }];
}

/** The OBS custom dock. No sign-in: the dock token in the URL is the credential. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const deck = isDeckId(params.deckId)
    ? await getDeck(context.cloudflare.env.DB, params.deckId)
    : null;
  if (!deck || !timingSafeEqual(token, deck.dockToken)) return { ok: false as const };
  return { ok: true as const, deckId: deck.id, token, name: deck.name };
}

const DEFAULT_SETTINGS: DockSettings = { obsUrl: OBS_DEFAULT_URL, password: "", screenshotDir: "" };

function storageKey(deckId: string) {
  return `deck-dock:${deckId}`;
}

function loadSettings(deckId: string): DockSettings {
  try {
    const raw = localStorage.getItem(storageKey(deckId));
    return raw
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DockSettings>) }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(deckId: string, settings: DockSettings) {
  try {
    localStorage.setItem(storageKey(deckId), JSON.stringify(settings));
  } catch {
    // storage blocked: settings last until the dock reloads
  }
}

const ROOM_LABEL = { connecting: "接続中…", open: "接続", offline: "再接続中…" } as const;
const OBS_LABEL = {
  connecting: "接続中…",
  open: "接続",
  offline: "未接続",
  "auth-failed": "パスワードが違います",
} as const;

function rejectedText(code: number | null): string | null {
  if (code === CLOSE_REVOKED)
    return "この URL は再発行されました。新しい URL をドックに設定してください。";
  if (code === CLOSE_REPLACED) return "別のドックが接続したため切断しました。";
  if (code === CLOSE_DELETED) return "このデッキは削除されました。";
  return null;
}

export default function Dock({ loaderData }: Route.ComponentProps) {
  if (!loaderData.ok) {
    return (
      <main className="dk-dock">
        <p className="dk-dock-error">
          この URL は使えません。デッキの編集画面から新しいドックの URL をコピーしてください。
        </p>
      </main>
    );
  }
  return <DockPanel deckId={loaderData.deckId} token={loaderData.token} name={loaderData.name} />;
}

function DockPanel({ deckId, token, name }: { deckId: string; token: string; name: string }) {
  const [settings, setSettings] = useState<DockSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [snapshot, setSnapshot] = useState<DockSnapshot | null>(null);
  const [editing, setEditing] = useState(false);
  const engine = useRef<DockEngine | null>(null);

  useEffect(() => {
    const loaded = loadSettings(deckId);
    settingsRef.current = loaded;
    setSettings(loaded);
    setEditing(
      !loaded.password &&
        loaded.obsUrl === OBS_DEFAULT_URL &&
        !localStorage.getItem(storageKey(deckId)),
    );
    const e = new DockEngine({
      deckId,
      token,
      settings: () => settingsRef.current,
      onChange: setSnapshot,
    });
    engine.current = e;
    e.start();
    return () => {
      e.stop();
      engine.current = null;
    };
  }, [deckId, token]);

  const save = (next: DockSettings) => {
    settingsRef.current = next;
    setSettings(next);
    saveSettings(deckId, next);
    engine.current?.reconnectObs();
    setEditing(false);
  };

  const room = snapshot?.room ?? "connecting";
  const obs = snapshot?.obs ?? "connecting";
  const rejected = rejectedText(snapshot?.rejected ?? null);
  const log = (snapshot?.log ?? []).slice(-30).reverse();

  return (
    <main className="dk-dock">
      <header className="dk-dock-head">
        <strong>{snapshot?.deck?.name ?? name}</strong>
        <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "閉じる" : "設定"}
        </Button>
      </header>

      {rejected && (
        <div className="dk-dock-error">
          <p>{rejected}</p>
          {snapshot?.rejected === CLOSE_REPLACED && (
            // Taking the deck back is deliberate: the other dock is then cut off.
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              このドックで接続し直す
            </Button>
          )}
        </div>
      )}

      <dl className="dk-dock-status">
        <div>
          <dt>deck.gdgs.jp</dt>
          <dd data-tone={room === "open" ? "ok" : "down"}>{ROOM_LABEL[room]}</dd>
        </div>
        <div>
          <dt>OBS</dt>
          <dd data-tone={obs === "open" ? "ok" : "down"}>
            {OBS_LABEL[obs]}
            {obs === "open" && snapshot?.state.obsVersion ? ` (${snapshot.state.obsVersion})` : ""}
          </dd>
        </div>
      </dl>
      {obs === "offline" && (
        <p className="dk-dock-help">
          OBS の「ツール」→「WebSocket
          サーバー設定」でサーバーを有効にし、ポートとパスワードを設定に入れてください。
        </p>
      )}

      {editing && <DockSettingsForm settings={settings} onSave={save} />}

      <section className="dk-dock-log" aria-label="操作ログ">
        {log.length === 0 ? (
          <p className="dk-muted">まだ操作はありません</p>
        ) : (
          <ol>
            {log.map((e) => (
              <li key={e.id} data-status={e.status}>
                <time>{new Date(e.at).toLocaleTimeString("ja-JP")}</time>
                <span>
                  {e.title || "（無題のキー）"} <span className="dk-muted">— {e.by}</span>
                  {e.error && <span className="dk-dock-log-error">{e.error}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function DockSettingsForm({
  settings,
  onSave,
}: { settings: DockSettings; onSave: (s: DockSettings) => void }) {
  return (
    <form
      className="dk-dock-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        onSave({
          obsUrl: String(form.get("obsUrl") || OBS_DEFAULT_URL).trim(),
          password: String(form.get("password") ?? ""),
          screenshotDir: String(form.get("screenshotDir") ?? "").trim(),
        });
      }}
    >
      <FormField label="obs-websocket の URL">
        <Input name="obsUrl" defaultValue={settings.obsUrl} placeholder={OBS_DEFAULT_URL} />
      </FormField>
      <FormField label="パスワード" description="この PC のこのドックにだけ保存されます。">
        <Input
          name="password"
          type="password"
          defaultValue={settings.password}
          autoComplete="off"
        />
      </FormField>
      <FormField label="スクリーンショットの保存先フォルダ" description="例: /Users/you/Movies">
        <Input name="screenshotDir" defaultValue={settings.screenshotDir} />
      </FormField>
      <Button type="submit" size="sm">
        保存して接続
      </Button>
    </form>
  );
}
