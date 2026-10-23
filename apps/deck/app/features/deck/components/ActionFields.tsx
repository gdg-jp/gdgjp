import { FormField, Input, Textarea } from "@gdgjp/design-system";
import { useId } from "react";
import { Choice } from "~/components/Choice";
import {
  ACTION_LABELS,
  ACTION_OPS,
  type ActionOp,
  MEDIA_OPS,
  MUTE_MODES,
  type MediaOp,
  type MuteMode,
  type ObsAction,
  type Ref,
  type Toggle,
  defaultAction,
  missingRefs,
} from "~/features/obs/actions";
import { type ObsState, audioInputs, mediaInputs, sourceNames } from "~/features/obs/state";

const TOGGLE_LABELS: Partial<Record<ActionOp, [string, string]>> = {
  stream: ["開始", "停止"],
  record: ["開始", "停止"],
  recordPause: ["一時停止", "再開"],
  virtualCam: ["開始", "停止"],
  replayBuffer: ["開始", "停止"],
  studioMode: ["オン", "オフ"],
  sourceVisibility: ["表示", "非表示"],
  filter: ["オン", "オフ"],
};

const MEDIA_LABELS: Record<MediaOp, string> = {
  playPause: "再生 / 一時停止",
  play: "再生",
  pause: "一時停止",
  stop: "停止",
  restart: "最初から",
  next: "次へ",
  previous: "前へ",
};

const MUTE_LABELS: Record<MuteMode, string> = {
  toggle: "切り替え",
  on: "ミュート",
  off: "ミュート解除",
  pushToMute: "押している間ミュート",
  pushToTalk: "押している間だけ話す",
};

/** Text input with suggestions from the live OBS. */
function NameField({
  label,
  value,
  options,
  onChange,
  placeholder,
  description,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
}) {
  const listId = useId();
  return (
    <FormField label={label} description={description}>
      <Input
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </FormField>
  );
}

function sceneUuid(obs: ObsState | null, name: string): string | null {
  return obs?.scenes.find((s) => s.name === name)?.uuid ?? null;
}

function sourceUuid(obs: ObsState | null, name: string): string | null {
  return sceneUuid(obs, name) ?? obs?.inputs[name]?.uuid ?? null;
}

function RefField({
  label,
  value,
  options,
  uuidOf,
  onChange,
  placeholder,
  description,
}: {
  label: string;
  value: Ref;
  options: string[];
  uuidOf: (name: string) => string | null;
  onChange: (ref: Ref) => void;
  placeholder?: string;
  description?: string;
}) {
  return (
    <NameField
      label={label}
      value={value.name}
      options={options}
      placeholder={placeholder}
      description={description}
      onChange={(name) =>
        onChange({ name, uuid: uuidOf(name) ?? (name === value.name ? value.uuid : null) })
      }
    />
  );
}

function ToggleField({
  op,
  value,
  onChange,
}: {
  op: ActionOp;
  value: Toggle;
  onChange: (mode: Toggle) => void;
}) {
  const [on, off] = TOGGLE_LABELS[op] ?? ["オン", "オフ"];
  return (
    <FormField label="動作">
      <Choice
        value={value}
        onChange={(v) => onChange(v as Toggle)}
        options={[
          { value: "toggle", label: "切り替え" },
          { value: "on", label: on },
          { value: "off", label: off },
        ]}
      />
    </FormField>
  );
}

/** Op picker + the fields of one OBS action. */
export function ActionFields({
  action,
  obs,
  onChange,
}: {
  action: ObsAction;
  obs: ObsState | null;
  onChange: (action: ObsAction) => void;
}) {
  const scenes = obs?.scenes.map((s) => s.name) ?? [];
  const sources = obs ? sourceNames(obs) : [];
  const warnings = obs?.connected ? missingRefs(action, obs) : [];

  return (
    <div className="dk-fields">
      <FormField label="操作">
        <Choice
          value={action.op}
          onChange={(v) => onChange(defaultAction(v as ActionOp))}
          options={ACTION_OPS.map((op) => ({ value: op, label: ACTION_LABELS[op] }))}
        />
      </FormField>
      <OpFields action={action} obs={obs} scenes={scenes} sources={sources} onChange={onChange} />
      {warnings.map((w) => (
        <p key={w} className="dk-warn">
          {w}
        </p>
      ))}
    </div>
  );
}

function OpFields({
  action,
  obs,
  scenes,
  sources,
  onChange,
}: {
  action: ObsAction;
  obs: ObsState | null;
  scenes: string[];
  sources: string[];
  onChange: (action: ObsAction) => void;
}) {
  const sceneOf = (name: string) => sceneUuid(obs, name);
  const sourceOf = (name: string) => sourceUuid(obs, name);
  switch (action.op) {
    case "stream":
    case "record":
    case "recordPause":
    case "virtualCam":
    case "replayBuffer":
    case "studioMode":
      return (
        <ToggleField
          op={action.op}
          value={action.mode}
          onChange={(mode) => onChange({ ...action, mode })}
        />
      );
    case "saveReplay":
    case "previewToProgram":
      return null;
    case "chapterMarker":
      return (
        <NameField
          label="チャプター名（空欄で OBS の既定）"
          value={action.name}
          options={[]}
          onChange={(name) => onChange({ ...action, name })}
        />
      );
    case "screenshot":
      return (
        <>
          <NameField
            label="ソース（空欄で番組のシーン）"
            value={action.source?.name ?? ""}
            options={sources}
            onChange={(name) =>
              onChange({ ...action, source: name ? { name, uuid: sourceOf(name) } : null })
            }
          />
          <FormField label="形式">
            <Choice
              value={action.format}
              onChange={(v) => onChange({ ...action, format: v === "jpg" ? "jpg" : "png" })}
              options={[
                { value: "png", label: "PNG" },
                { value: "jpg", label: "JPEG" },
              ]}
            />
          </FormField>
        </>
      );
    case "scene":
      return (
        <>
          <RefField
            label="シーン"
            value={action.scene}
            options={scenes}
            uuidOf={sceneOf}
            onChange={(scene) => onChange({ ...action, scene })}
          />
          <FormField label="切り替え先">
            <Choice
              value={action.target}
              onChange={(v) =>
                onChange({ ...action, target: v === "preview" ? "preview" : "program" })
              }
              options={[
                { value: "program", label: "番組（本番）" },
                { value: "preview", label: "プレビュー（スタジオモード）" },
              ]}
            />
          </FormField>
        </>
      );
    case "sceneCollection":
      return (
        <NameField
          label="シーンコレクション"
          value={action.name}
          options={obs?.sceneCollections ?? []}
          onChange={(name) => onChange({ ...action, name })}
        />
      );
    case "profile":
      return (
        <NameField
          label="プロファイル"
          value={action.name}
          options={obs?.profiles ?? []}
          onChange={(name) => onChange({ ...action, name })}
        />
      );
    case "hotkey":
      return (
        <NameField
          label="ホットキー名"
          value={action.name}
          options={obs?.hotkeys ?? []}
          placeholder="OBSBasic.StartStreaming"
          onChange={(name) => onChange({ ...action, name })}
        />
      );
    case "sourceVisibility": {
      const resolved = obs?.items[action.scene.name] ?? [];
      return (
        <>
          <RefField
            label="シーン"
            value={action.scene}
            options={scenes}
            uuidOf={sceneOf}
            onChange={(scene) => onChange({ ...action, scene })}
          />
          <RefField
            label="ソース"
            value={action.source}
            options={resolved.map((i) => i.source)}
            uuidOf={sourceOf}
            onChange={(source) => onChange({ ...action, source })}
          />
          <ToggleField
            op="sourceVisibility"
            value={action.mode}
            onChange={(mode) => onChange({ ...action, mode })}
          />
        </>
      );
    }
    case "filter":
      return (
        <>
          <RefField
            label="ソース"
            value={action.source}
            options={sources}
            uuidOf={sourceOf}
            onChange={(source) => onChange({ ...action, source })}
          />
          <NameField
            label="フィルター"
            value={action.filter}
            options={(obs?.filters[action.source.name] ?? []).map((f) => f.name)}
            onChange={(filter) => onChange({ ...action, filter })}
          />
          <ToggleField
            op="filter"
            value={action.mode}
            onChange={(mode) => onChange({ ...action, mode })}
          />
        </>
      );
    case "transition":
      return (
        <>
          <NameField
            label="トランジション"
            value={action.name}
            options={obs?.transitions ?? []}
            onChange={(name) => onChange({ ...action, name })}
          />
          <FormField label="長さ（ミリ秒、空欄で変更しない）">
            <Input
              type="number"
              min={50}
              max={20000}
              value={action.durationMs ?? ""}
              onChange={(e) => {
                const ms = Number(e.currentTarget.value);
                onChange({ ...action, durationMs: e.currentTarget.value && ms > 0 ? ms : null });
              }}
            />
          </FormField>
        </>
      );
    case "media":
      return (
        <>
          <RefField
            label="メディアソース"
            value={action.input}
            options={obs ? mediaInputs(obs) : []}
            uuidOf={sourceOf}
            onChange={(input) => onChange({ ...action, input })}
          />
          <FormField label="動作">
            <Choice
              value={action.media}
              onChange={(v) => onChange({ ...action, media: v as MediaOp })}
              options={MEDIA_OPS.map((m) => ({ value: m, label: MEDIA_LABELS[m] }))}
            />
          </FormField>
        </>
      );
    case "mute":
      return (
        <>
          <RefField
            label="音声ソース"
            value={action.input}
            options={obs ? audioInputs(obs) : []}
            uuidOf={sourceOf}
            onChange={(input) => onChange({ ...action, input })}
          />
          <FormField label="動作">
            <Choice
              value={action.mode}
              onChange={(v) => onChange({ ...action, mode: v as MuteMode })}
              options={MUTE_MODES.map((m) => ({ value: m, label: MUTE_LABELS[m] }))}
            />
          </FormField>
        </>
      );
    case "volume":
      return (
        <>
          <RefField
            label="音声ソース"
            value={action.input}
            options={obs ? audioInputs(obs) : []}
            uuidOf={sourceOf}
            onChange={(input) => onChange({ ...action, input })}
          />
          <FormField label="動作">
            <Choice
              value={action.mode}
              onChange={(v) => {
                const mode = v as "step" | "set" | "slider";
                onChange({ ...action, mode, db: mode === "step" ? 3 : mode === "set" ? -10 : 0 });
              }}
              options={[
                { value: "step", label: "上げ下げ（± dB）" },
                { value: "set", label: "指定の音量にする" },
                { value: "slider", label: "スライダーを開く" },
              ]}
            />
          </FormField>
          {action.mode !== "slider" && (
            <FormField
              label={action.mode === "step" ? "変える量（dB、下げるならマイナス）" : "音量（dB）"}
            >
              <Input
                type="number"
                step={0.5}
                min={action.mode === "step" ? -60 : -60}
                max={action.mode === "step" ? 60 : 0}
                value={action.db}
                onChange={(e) => onChange({ ...action, db: Number(e.currentTarget.value) || 0 })}
              />
            </FormField>
          )}
        </>
      );
    case "raw":
      return (
        <>
          <FormField label="requestType" description="obs-websocket v5 のリクエスト名">
            <Input
              value={action.requestType}
              placeholder="SetInputSettings"
              onChange={(e) => onChange({ ...action, requestType: e.currentTarget.value.trim() })}
            />
          </FormField>
          <FormField label="requestData（JSON）">
            <Textarea
              rows={5}
              className="dk-mono"
              value={action.requestData}
              placeholder='{"inputName": "Mic"}'
              onChange={(e) => onChange({ ...action, requestData: e.currentTarget.value })}
            />
          </FormField>
        </>
      );
  }
}
