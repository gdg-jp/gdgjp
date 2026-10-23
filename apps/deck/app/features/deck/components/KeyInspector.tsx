import { Button, FormField, IconButton, Icons, Input, Switch, toast } from "@gdgjp/design-system";
import { useRef, useState } from "react";
import { Choice } from "~/components/Choice";
import { type ObsAction, defaultAction } from "~/features/obs/actions";
import type { ObsState } from "~/features/obs/state";
import { withAction } from "../editing";
import { KEY_ICONS } from "../icons";
import {
  type Behavior,
  DEFAULT_LOOK,
  type DeckLayout,
  KEY_COLORS,
  type Key,
  type KeyColor,
  type KeyLook,
  MAX_TITLE,
  ROOT_BOARD,
  type Step,
} from "../model";
import { ActionFields } from "./ActionFields";
import { KeyFace } from "./KeyFace";

const COLOR_LABELS: Record<KeyColor, string> = {
  neutral: "グレー",
  blue: "青",
  red: "赤",
  green: "緑",
  yellow: "黄",
  slate: "スレート",
  black: "黒",
};

const BEHAVIOR_LABELS: Record<Behavior["type"], string> = {
  action: "OBS の操作",
  multi: "マルチアクション",
  multiSwitch: "マルチアクションスイッチ",
  folder: "フォルダを開く",
  back: "フォルダから戻る",
  page: "ページを移動",
};

function defaultBehavior(type: Behavior["type"], layout: DeckLayout): Behavior {
  switch (type) {
    case "action":
      return { type, action: defaultAction("scene") };
    case "multi":
      return { type, steps: [] };
    case "multiSwitch":
      return { type, a: [], b: [] };
    case "folder": {
      const first = Object.keys(layout.boards).find((id) => id !== ROOT_BOARD);
      return first ? { type, board: first } : { type: "back" };
    }
    case "back":
      return { type };
    case "page":
      return { type, to: "next" };
  }
}

/** Shrinks an image to 256 px (longest side) as WebP before upload. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const webp = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  if (webp && webp.type === "image/webp") return webp;
  // Safari cannot encode WebP.
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("画像を変換できません");
  return png;
}

function LookFields({
  deckId,
  look,
  onChange,
}: {
  deckId: string;
  look: KeyLook;
  onChange: (look: KeyLook) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", await shrink(file), "key");
      const res = await fetch(`/api/decks/${deckId}/images`, { method: "POST", body });
      const json = (await res.json().catch(() => null)) as {
        ok: boolean;
        id?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.id) {
        toast.error(
          json?.error === "type"
            ? "PNG / JPEG / WebP の画像にしてください"
            : "アップロードできませんでした",
        );
        return;
      }
      onChange({ ...look, image: json.id });
    } catch {
      toast.error("アップロードできませんでした");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="dk-fields">
      <fieldset className="dk-swatches">
        <legend>背景色</legend>
        {KEY_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="dk-swatch"
            data-color={c}
            aria-label={COLOR_LABELS[c]}
            aria-pressed={look.color === c}
            onClick={() => onChange({ ...look, color: c })}
          />
        ))}
      </fieldset>
      <fieldset className="dk-icon-picker">
        <legend>アイコン</legend>
        <button
          type="button"
          className="dk-icon-choice"
          aria-label="アイコンなし"
          aria-pressed={!look.icon}
          onClick={() => onChange({ ...look, icon: null })}
        >
          —
        </button>
        {KEY_ICONS.map((name) => (
          <button
            key={name}
            type="button"
            className="dk-icon-choice"
            aria-label={name}
            aria-pressed={look.icon === name}
            onClick={() => onChange({ ...look, icon: name })}
          >
            <Icons name={name} size={18} animateOnHover={false} aria-hidden="true" />
          </button>
        ))}
      </fieldset>
      <div className="dk-image-row">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          loading={uploading}
          onClick={() => fileRef.current?.click()}
        >
          画像をアップロード
        </Button>
        {look.image && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...look, image: null })}>
            画像を外す
          </Button>
        )}
      </div>
    </div>
  );
}

function StepsEditor({
  label,
  steps,
  obs,
  onChange,
}: {
  label: string;
  steps: Step[];
  obs: ObsState | null;
  onChange: (steps: Step[]) => void;
}) {
  const update = (i: number, step: Step) => onChange(steps.map((s, j) => (j === i ? step : s)));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const next = steps.slice();
    const [s] = next.splice(i, 1);
    if (s) next.splice(to, 0, s);
    onChange(next);
  };
  return (
    <fieldset className="dk-steps">
      <legend>{label}</legend>
      <ol>
        {steps.map((step, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps have no ids; order is the identity.
          <li key={i} className="dk-step">
            <div className="dk-step-head">
              <span className="dk-step-no">{i + 1}</span>
              <span className="dk-spacer" />
              <IconButton
                aria-label="上へ"
                variant="ghost"
                size="sm"
                onClick={() => move(i, i - 1)}
              >
                <Icons name="ChevronUp" size={16} animateOnHover={false} aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label="下へ"
                variant="ghost"
                size="sm"
                onClick={() => move(i, i + 1)}
              >
                <Icons name="ChevronDown" size={16} animateOnHover={false} aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label="削除"
                variant="ghost"
                size="sm"
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
              >
                <Icons name="Trash2" size={16} animateOnHover={false} aria-hidden="true" />
              </IconButton>
            </div>
            {step.type === "wait" ? (
              <FormField label="待つ（ミリ秒）">
                <Input
                  type="number"
                  min={0}
                  max={60000}
                  step={100}
                  value={step.ms}
                  onChange={(e) =>
                    update(i, { type: "wait", ms: Math.max(0, Number(e.currentTarget.value) || 0) })
                  }
                />
              </FormField>
            ) : (
              <ActionFields
                action={step.action}
                obs={obs}
                onChange={(action: ObsAction) => update(i, { type: "obs", action })}
              />
            )}
          </li>
        ))}
      </ol>
      <div className="dk-step-add">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, { type: "obs", action: defaultAction("scene") }])}
        >
          操作を追加
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...steps, { type: "wait", ms: 500 }])}
        >
          待ち時間を追加
        </Button>
      </div>
    </fieldset>
  );
}

/** The editor's right panel: everything about the selected key. */
export function KeyInspector({
  deckId,
  layout,
  keyDef,
  obs,
  on,
  onChange,
  onDelete,
}: {
  deckId: string;
  layout: DeckLayout;
  keyDef: Key;
  obs: ObsState | null;
  on: boolean | null;
  onChange: (key: Key) => void;
  onDelete: () => void;
}) {
  const [editOn, setEditOn] = useState(false);
  const b = keyDef.behavior;
  const folders = Object.values(layout.boards).filter((board) => board.id !== ROOT_BOARD);
  const hasState = b.type === "action" || b.type === "multiSwitch";

  return (
    <div className="dk-inspector">
      <div className="dk-inspector-preview">
        <span className="dk-key dk-key-preview">
          <KeyFace deckId={deckId} keyDef={keyDef} on={editOn ? true : on} />
        </span>
        <IconButton aria-label="キーを削除" variant="ghost" onClick={onDelete}>
          <Icons name="Trash2" size={18} animateOnHover={false} aria-hidden="true" />
        </IconButton>
      </div>

      <FormField label="タイトル">
        <Input
          value={keyDef.title}
          maxLength={MAX_TITLE}
          onChange={(e) => onChange({ ...keyDef, title: e.currentTarget.value })}
        />
      </FormField>

      <FormField label="種類">
        <Choice
          value={b.type}
          onChange={(v) =>
            onChange({ ...keyDef, behavior: defaultBehavior(v as Behavior["type"], layout) })
          }
          options={(Object.keys(BEHAVIOR_LABELS) as Behavior["type"][]).map((t) => ({
            value: t,
            label: BEHAVIOR_LABELS[t],
            disabled: t === "folder" && folders.length === 0,
          }))}
        />
      </FormField>

      {b.type === "action" && (
        <ActionFields
          action={b.action}
          obs={obs}
          onChange={(action) => onChange(withAction(keyDef, action))}
        />
      )}
      {b.type === "multi" && (
        <StepsEditor
          label="順に実行"
          steps={b.steps}
          obs={obs}
          onChange={(steps) => onChange({ ...keyDef, behavior: { ...b, steps } })}
        />
      )}
      {b.type === "multiSwitch" && (
        <>
          <StepsEditor
            label="1 回目（奇数回）"
            steps={b.a}
            obs={obs}
            onChange={(a) => onChange({ ...keyDef, behavior: { ...b, a } })}
          />
          <StepsEditor
            label="2 回目（偶数回）"
            steps={b.b}
            obs={obs}
            onChange={(steps) => onChange({ ...keyDef, behavior: { ...b, b: steps } })}
          />
        </>
      )}
      {b.type === "folder" && (
        <FormField label="フォルダ">
          <Choice
            value={b.board}
            onChange={(board) => onChange({ ...keyDef, behavior: { type: "folder", board } })}
            options={folders.map((f) => ({ value: f.id, label: f.name }))}
          />
        </FormField>
      )}
      {b.type === "page" && (
        <FormField label="移動先">
          <Choice
            value={String(b.to)}
            onChange={(v) =>
              onChange({
                ...keyDef,
                behavior: { type: "page", to: v === "next" || v === "prev" ? v : Number(v) },
              })
            }
            options={[
              { value: "next", label: "次のページ" },
              { value: "prev", label: "前のページ" },
              ...Array.from({ length: 10 }, (_, i) => ({
                value: String(i),
                label: `${i + 1} ページ目`,
              })),
            ]}
          />
        </FormField>
      )}

      {b.type !== "folder" && b.type !== "back" && b.type !== "page" && (
        <FormField label="誤操作の防止">
          <Choice
            value={keyDef.confirm.mode}
            onChange={(mode) => {
              onChange({
                ...keyDef,
                confirm:
                  mode === "hold"
                    ? { mode: "hold", ms: 1500 }
                    : mode === "double"
                      ? { mode: "double" }
                      : { mode: "none" },
              });
            }}
            options={[
              { value: "none", label: "なし" },
              { value: "hold", label: "長押し" },
              { value: "double", label: "2 回タップ" },
            ]}
          />
        </FormField>
      )}
      {keyDef.confirm.mode === "hold" && (
        <FormField label="長押しの秒数">
          <Input
            type="number"
            min={0.2}
            max={5}
            step={0.1}
            value={keyDef.confirm.ms / 1000}
            onChange={(e) =>
              onChange({
                ...keyDef,
                confirm: {
                  mode: "hold",
                  ms: Math.round(
                    Math.min(5, Math.max(0.2, Number(e.currentTarget.value) || 1.5)) * 1000,
                  ),
                },
              })
            }
          />
        </FormField>
      )}

      <h3 className="dk-inspector-heading">見た目</h3>
      <LookFields
        deckId={deckId}
        look={keyDef.look}
        onChange={(look) => onChange({ ...keyDef, look })}
      />

      {hasState && (
        <>
          <div className="dk-inspector-toggle">
            <span>オンのときの見た目を変える</span>
            <Switch
              checked={!!keyDef.lookOn}
              aria-label="オンのときの見た目を変える"
              onCheckedChange={(checked) =>
                onChange({
                  ...keyDef,
                  lookOn: checked ? { ...DEFAULT_LOOK, ...keyDef.look, color: "red" } : null,
                })
              }
            />
          </div>
          {keyDef.lookOn ? (
            <LookFields
              deckId={deckId}
              look={keyDef.lookOn}
              onChange={(lookOn) => onChange({ ...keyDef, lookOn })}
            />
          ) : (
            <p className="dk-help">
              オンのとき（配信中・ライブのシーン・ミュート中など）は赤い枠で示します。
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            onMouseDown={() => setEditOn(true)}
            onMouseUp={() => setEditOn(false)}
            onMouseLeave={() => setEditOn(false)}
          >
            押している間オンの見た目をプレビュー
          </Button>
        </>
      )}
    </div>
  );
}
