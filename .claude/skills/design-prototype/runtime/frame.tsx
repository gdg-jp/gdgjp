import { ThemeProvider, Toaster } from "@gdgjp/design-system";
import { Component, type ReactNode, useEffect, useState } from "react";
import { type ControlValues, type Prototype, initialControls } from "./kit";

export type Theme = "light" | "dark";

/** What a frame document renders: one board frame, or the interactive App. */
export interface FrameConfig {
  target: string;
  theme: Theme;
  controls?: ControlValues;
}

export type FrameMessage =
  | { type: "proto:ready"; target: string }
  | { type: "proto:issue"; target: string; level: "error" | "warning"; message: string };

const NAME_PREFIX = "proto:";

export function frameName(config: FrameConfig) {
  return NAME_PREFIX + JSON.stringify(config);
}

/**
 * A frame document is either an iframe named by the board, or the top-level page opened as
 * `#solo=<frame id | app>&theme=<light|dark>&controls=<json>` (used by check.mjs and for links).
 */
export function readFrameConfig(): FrameConfig | null {
  if (window.name.startsWith(NAME_PREFIX)) return JSON.parse(window.name.slice(NAME_PREFIX.length));
  const params = new URLSearchParams(location.hash.slice(1));
  const solo = params.get("solo");
  if (!solo) return null;
  const theme = params.get("theme");
  const controls = params.get("controls");
  return {
    target: solo,
    theme:
      theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light",
    controls: controls ? JSON.parse(controls) : undefined,
  };
}

function post(message: FrameMessage) {
  if (window.parent !== window) window.parent.postMessage(message, "*");
}

function stringify(args: unknown[]) {
  return args
    .map((arg) => (arg instanceof Error ? arg.stack || arg.message : String(arg)))
    .join(" ");
}

/** Forward console errors and warnings to the board, which flags the frame. */
export function captureIssues(target: string) {
  const report = (level: "error" | "warning", message: string) =>
    post({ type: "proto:issue", target, level, message });
  const { error, warn } = console;
  console.error = (...args: unknown[]) => {
    report("error", stringify(args));
    error.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    report("warning", stringify(args));
    warn.apply(console, args);
  };
  window.addEventListener("error", (event) => report("error", event.message));
  window.addEventListener("unhandledrejection", (event) =>
    report("error", stringify([event.reason])),
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <pre className="m-4 whitespace-pre-wrap rounded-md bg-[var(--gdg-danger-surface)] p-4 text-sm text-danger">
        {this.state.error.stack || this.state.error.message}
      </pre>
    );
  }
}

export function FrameHost({ prototype, config }: { prototype: Prototype; config: FrameConfig }) {
  const [theme, setTheme] = useState(config.theme);
  const [controls, setControls] = useState(() => initialControls(prototype, config.controls));
  const frame = prototype.frames.find((item) => item.id === config.target);
  const App = prototype.App;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "proto:theme") setTheme(event.data.theme);
      if (event.data?.type === "proto:controls") setControls(event.data.controls);
    };
    window.addEventListener("message", onMessage);
    let cancelled = false;
    document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) post({ type: "proto:ready", target: config.target });
        }),
      ),
    );
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
    };
  }, [config.target]);

  useEffect(() => {
    document.title = frame ? `${frame.screen} — ${frame.state}` : prototype.title;
  }, [frame, prototype.title]);

  return (
    <ThemeProvider forcedTheme={theme} storageKey="gdg-prototype-frame-theme">
      <ErrorBoundary>
        {config.target === "app" ? (
          <App controls={controls} />
        ) : frame ? (
          frame.render()
        ) : (
          <p className="p-4">Unknown frame: {config.target}</p>
        )}
      </ErrorBoundary>
      <Toaster />
    </ThemeProvider>
  );
}
