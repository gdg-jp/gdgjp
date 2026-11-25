import { useEffect } from "react";
import type { EffectCallback } from "react";

export function useMountEffect(effect: EffectCallback): void {
  useEffect(effect, []);
}
