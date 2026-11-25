import { useAnimationFrame, useTimeout } from "@gdgjp/gdg-lib/react";
import { useRef, useState } from "react";
import { isMomentary } from "~/features/obs/actions";
import type { Phase } from "~/features/obs/requests";
import { buzz } from "~/lib/haptics";
import type { Key } from "../model";
import { KeyFace } from "./KeyFace";

const DOUBLE_TAP_MS = 1500;

export function ControllerKey({
  deckId,
  keyDef,
  on,
  badge,
  disabled,
  onPress,
  onNavigate,
  onSlider,
}: {
  deckId: string;
  keyDef: Key;
  on: boolean | null;
  badge: string | null;
  disabled: boolean;
  onPress: (phase: Phase) => void;
  onNavigate: () => void;
  onSlider: () => void;
}) {
  const b = keyDef.behavior;
  const navigates = b.type === "folder" || b.type === "back" || b.type === "page";
  const slider = b.type === "action" && b.action.op === "volume" && b.action.mode === "slider";
  const momentary = b.type === "action" && isMomentary(b.action);
  const confirm = navigates || slider || momentary ? { mode: "none" as const } : keyDef.confirm;

  const [progress, setProgress] = useState(0);
  const [armed, setArmed] = useState(false);
  const hold = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  const armTimer = useTimeout();
  const down = useRef(false);

  const fire = () => {
    buzz(confirm.mode === "none" ? 12 : [10, 40, 20]);
    onPress("press");
  };

  const cancelHold = () => {
    hold.current = null;
    setHolding(false);
    setProgress(0);
  };

  useAnimationFrame(() => {
    const start = hold.current;
    if (start === null || confirm.mode !== "hold") return;
    const p = Math.min(1, (performance.now() - start) / confirm.ms);
    setProgress(p);
    if (p >= 1) {
      cancelHold();
      fire();
    }
  }, holding);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled && !navigates) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (momentary) {
      down.current = true;
      buzz(10);
      onPress("down");
      return;
    }
    if (confirm.mode !== "hold") return;
    hold.current = performance.now();
    setHolding(true);
  };

  const onPointerEnd = () => {
    if (momentary && down.current) {
      down.current = false;
      onPress("up");
      return;
    }
    if (confirm.mode === "hold") cancelHold();
  };

  const onClick = () => {
    if (navigates) {
      buzz(8);
      onNavigate();
      return;
    }
    if (disabled || momentary || confirm.mode === "hold") return;
    if (slider) {
      onSlider();
      return;
    }
    if (confirm.mode === "double") {
      if (!armed) {
        setArmed(true);
        buzz(8);
        armTimer.start(() => setArmed(false), DOUBLE_TAP_MS);
        return;
      }
      armTimer.cancel();
      setArmed(false);
    }
    fire();
  };

  const hint =
    confirm.mode === "hold"
      ? `${(confirm.ms / 1000).toFixed(1)} 秒長押し`
      : confirm.mode === "double"
        ? "2 回タップ"
        : momentary
          ? "押している間"
          : undefined;

  return (
    <button
      type="button"
      className="dk-key"
      data-disabled={(disabled && !navigates) || undefined}
      aria-label={[keyDef.title || "キー", hint].filter(Boolean).join("（") + (hint ? "）" : "")}
      aria-pressed={on ?? undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <KeyFace
        deckId={deckId}
        keyDef={keyDef}
        on={on}
        badge={badge}
        progress={progress}
        armed={armed}
      />
    </button>
  );
}
