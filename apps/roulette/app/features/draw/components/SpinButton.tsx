import { Button, Icons } from "@gdgjp/design-system";
import { useEffect, useRef } from "react";
import { reducedMotion } from "../feedback";

/**
 * The spin button. Holding it charges the spin (the fill grows); releasing —
 * or a click / Enter — spins. While idle a halo pulses behind it; the button
 * itself stays still so it is easy to hit.
 */
export function SpinButton({
  label,
  charge = 0,
  disabled,
  pulse,
  onChargeStart,
  onChargeCancel,
  onSpin,
}: {
  label: string;
  charge?: number;
  disabled?: boolean;
  pulse?: boolean;
  onChargeStart?: () => void;
  onChargeCancel?: () => void;
  onSpin?: () => void;
}) {
  const halo = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!pulse || reducedMotion()) return;
    const animation = halo.current?.animate(
      [
        { scale: "1 1", opacity: 0.45 },
        { scale: "1.05 1.6", opacity: 0 },
      ],
      {
        duration: 1600,
        iterations: Number.POSITIVE_INFINITY,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      },
    );
    return () => animation?.cancel();
  }, [pulse]);
  return (
    <div className="relative">
      {pulse && (
        <span
          ref={halo}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-md bg-primary opacity-0"
        />
      )}
      <Button
        size="lg"
        fullWidth
        disabled={disabled}
        className="relative touch-manipulation select-none overflow-hidden text-lg [-webkit-touch-callout:none]"
        onPointerDown={disabled ? undefined : onChargeStart}
        onPointerLeave={(event) => {
          // Touch fires pointerleave after the finger lifts too; only a press
          // dragged off the button cancels.
          if (event.buttons) onChargeCancel?.();
        }}
        onPointerCancel={onChargeCancel}
        onContextMenu={(event) => event.preventDefault()}
        onClick={onSpin}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-primary-foreground/30"
          style={{ width: `${Math.round(charge * 100)}%` }}
        />
        <span className="relative inline-flex items-center gap-2">
          <Icons name="RotateCw" size={20} aria-hidden="true" />
          {label}
        </span>
      </Button>
    </div>
  );
}
