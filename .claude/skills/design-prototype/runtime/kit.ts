import { type ComponentType, type ReactNode, useSyncExternalStore } from "react";

export type Viewport = "desktop" | "mobile";

export const viewportSize: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

export interface Frame {
  id: string;
  screen: string;
  state: string;
  note?: string;
  viewport?: Viewport;
  height?: number;
  render: () => ReactNode;
}

export interface Control {
  id: string;
  label: string;
  options: { value: string; label: string }[];
}

export type ControlValues = Record<string, string>;

export type FlowStep =
  | { click: string }
  | { fill: string; value: string }
  | { select: string; option: string }
  | { press: string }
  | { expect: string }
  | { control: string; value: string };

export interface Flow {
  name: string;
  viewport?: Viewport;
  controls?: ControlValues;
  steps: FlowStep[];
}

export interface Prototype {
  title: string;
  summary?: string;
  viewport?: Viewport;
  frames: Frame[];
  controls?: Control[];
  flows?: Flow[];
  App: ComponentType<{ controls: ControlValues }>;
}

export function definePrototype(prototype: Prototype): Prototype {
  const seen = new Set<string>();
  for (const frame of prototype.frames) {
    if (seen.has(frame.id)) throw new Error(`Duplicate frame id: ${frame.id}`);
    seen.add(frame.id);
  }
  return prototype;
}

export function initialControls(prototype: Prototype, values: ControlValues = {}): ControlValues {
  return Object.fromEntries(
    (prototype.controls ?? []).map((control) => [
      control.id,
      values[control.id] ?? control.options[0]?.value ?? "",
    ]),
  );
}

const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile() {
  return useSyncExternalStore(
    (onChange) => {
      const query = matchMedia(MOBILE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => matchMedia(MOBILE_QUERY).matches,
  );
}
