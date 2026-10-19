import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Switch,
} from "@gdgjp/design-system";
import { useEffect, useId, useState } from "react";
import { AudioLines } from "~/components/icons";
import {
  DEFAULT_DENOISE,
  DENOISE_MAX_DB,
  DENOISE_MIN_DB,
  type DenoiseSetting,
  type DenoiseState,
} from "../../protocol";

/** Why the speaker's mic is not going through DeepFilterNet3 although it is on. */
export const DENOISE_FALLBACK_LABEL: Record<Exclude<DenoiseState, "active" | "off">, string> = {
  loading: "ノイズ除去を準備中（ブラウザ標準で処理中）",
  unsupported: "このブラウザではノイズ除去が使えません（ブラウザ標準で処理中）",
  overload: "PC の負荷が高いためノイズ除去を停止しました（ブラウザ標準で処理中）",
};

export function denoiseFallback(
  setting: DenoiseSetting | undefined,
  state: DenoiseState | null,
): Exclude<DenoiseState, "active" | "off"> | null {
  if (!(setting ?? DEFAULT_DENOISE).on || state === null || state === "active" || state === "off") {
    return null;
  }
  return state;
}

/**
 * The operator's per-speaker DeepFilterNet3 switch and strength. The speaker
 * never sees it; their page applies changes live.
 */
export function DenoiseControl({
  name,
  setting = DEFAULT_DENOISE,
  onChange,
}: {
  name: string;
  setting?: DenoiseSetting;
  onChange: (patch: Partial<DenoiseSetting>) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(setting.attenDb);
  useEffect(() => setDraft(setting.attenDb), [setting.attenDb]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={`${name} のノイズ除去（${setting.on ? `${setting.attenDb} dB` : "オフ"}）`}
          variant="ghost"
          size="sm"
          className="sc-denoise-trigger"
          data-off={setting.on ? undefined : true}
        >
          <AudioLines size={16} aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="sc-denoise">
        <div className="sc-denoise-row">
          <span id={`${id}-on`}>ノイズ除去</span>
          <Switch
            aria-labelledby={`${id}-on`}
            checked={setting.on}
            onCheckedChange={(on) => onChange({ on })}
          />
        </div>
        <div className="sc-denoise-row" data-disabled={setting.on ? undefined : true}>
          <span>強さ</span>
          <output className="sc-denoise-value">{draft} dB</output>
        </div>
        <Slider
          aria-label="最大どれだけノイズを下げるか（dB）"
          min={DENOISE_MIN_DB}
          max={DENOISE_MAX_DB}
          step={1}
          value={[draft]}
          disabled={!setting.on}
          onValueChange={([v]) => v !== undefined && setDraft(v)}
          onValueCommit={([v]) => v !== undefined && onChange({ attenDb: v })}
        />
        <p className="sc-denoise-help">
          強いほど雑音が消えますが、声もこもりやすくなります。既定は {DEFAULT_DENOISE.attenDb} dB。
        </p>
      </PopoverContent>
    </Popover>
  );
}
