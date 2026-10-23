import { type ComponentType, type ReactNode, useSyncExternalStore } from "react";

export type Viewport = "desktop" | "mobile";

export const viewportSize: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

/** One static state of one screen, shown as a frame on the mockup board. */
export interface Frame {
  /** Unique kebab-case id; also used for `#frame=<id>` and `#solo=<id>` links. */
  id: string;
  /** Screen name. Frames with the same screen are grouped on the board. */
  screen: string;
  /** State name, e.g. 通常 / 0件 / 入力エラー / 読み込み中 / 確認ダイアログ. */
  state: string;
  /** Reviewer-facing note: what to look at in this state. */
  note?: string;
  viewport?: Viewport;
  /** Frame height in CSS px when the state needs more than the viewport height. */
  height?: number;
  render: () => ReactNode;
}

/**
 * A prototype-only switch in the 操作 tab toolbar, such as the design variant being compared
 * or whose viewpoint (applicant / approver) the App shows. It never appears in the product UI.
 */
export interface Control {
  id: string;
  label: string;
  /** The first option is the initial value. */
  options: { value: string; label: string }[];
}

export type ControlValues = Record<string, string>;

/** One step that scripts/check.mjs plays in the App. Names are accessible names or labels. */
export type FlowStep =
  /** Click a button, link, tab, menu item, option, checkbox, radio or switch by its name. */
  | { click: string }
  /** Type into the input or textarea with this label (or placeholder). */
  | { fill: string; value: string }
  /** Pick `option` in the Select or native select with this label. */
  | { select: string; option: string }
  /** Press a key, such as "Enter" or "Escape". */
  | { press: string }
  /** Assert that this text is visible. */
  | { expect: string }
  /** Change a prototype control, e.g. switch the viewpoint to the approver. */
  | { control: string; value: string };

/** A main flow from spec.md 画面遷移, played step by step by scripts/check.mjs. */
export interface Flow {
  name: string;
  viewport?: Viewport;
  /** Initial control values; unspecified controls start at their first option. */
  controls?: ControlValues;
  steps: FlowStep[];
}

export interface Prototype {
  title: string;
  summary?: string;
  /** Default viewport for frames and the interactive view. */
  viewport?: Viewport;
  frames: Frame[];
  controls?: Control[];
  flows?: Flow[];
  /** The interactive prototype. Navigation lives in React state, not in the URL. */
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

/** True below the design system's 768px breakpoint, for behavior that differs on phones. */
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
