import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ThemeProvider,
  ToggleGroup,
  ToggleGroupItem,
} from "@gdgjp/design-system";
import { ListChecks, Monitor, Moon, RotateCcw, Smartphone, Sun } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { type FrameConfig, type FrameMessage, type Theme, frameName } from "./frame";
import {
  type Control,
  type ControlValues,
  type Flow,
  type FlowStep,
  type Frame,
  type Prototype,
  type Viewport,
  initialControls,
  viewportSize,
} from "./kit";

type View = "board" | "play" | "spec";

interface FrameStatus {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

declare global {
  interface Window {
    /** Read by scripts/check.mjs. */
    __proto?: {
      frames: {
        id: string;
        screen: string;
        state: string;
        viewport: Viewport;
        width: number;
        height: number;
      }[];
      viewport: Viewport;
      controls: Control[];
      flows: Flow[];
      status: Record<string, FrameStatus>;
    };
  }
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const view = params.get("view");
  return {
    view: (view === "play" || view === "spec" ? view : "board") as View,
    frame: params.get("frame"),
    eager: params.has("eager"),
  };
}

function writeHash(view: View, frame: string | null) {
  const params = new URLSearchParams(location.hash.slice(1));
  params.set("view", view);
  if (frame) params.set("frame", frame);
  else params.delete("frame");
  history.replaceState(null, "", `#${params}`);
}

/** The whole page as a document an iframe can load, so every frame gets its own viewport. */
function useFrameDocument() {
  return useMemo(() => {
    const css = document.getElementById("proto-css")?.textContent ?? "";
    const js = document.getElementById("proto-js")?.textContent ?? "";
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module">${js}</script></body></html>`;
  }, []);
}

function useFrameStatus(prototype: Prototype) {
  const [status, setStatus] = useState<Record<string, FrameStatus>>({});
  useEffect(() => {
    const onMessage = (event: MessageEvent<FrameMessage>) => {
      const data = event.data;
      if (data?.type !== "proto:ready" && data?.type !== "proto:issue") return;
      setStatus((current) => {
        const entry = current[data.target] ?? { ready: false, errors: [], warnings: [] };
        const next =
          data.type === "proto:ready"
            ? { ...entry, ready: true }
            : data.level === "error"
              ? { ...entry, errors: [...entry.errors, data.message] }
              : { ...entry, warnings: [...entry.warnings, data.message] };
        return { ...current, [data.target]: next };
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    const fallback = prototype.viewport ?? "desktop";
    window.__proto = {
      frames: prototype.frames.map((frame) => ({
        id: frame.id,
        screen: frame.screen,
        state: frame.state,
        ...frameSize(frame, fallback),
      })),
      viewport: fallback,
      controls: prototype.controls ?? [],
      flows: prototype.flows ?? [],
      status,
    };
  }, [prototype, status]);
  return status;
}

function FrameView({
  doc,
  config,
  width,
  height,
  title,
  className,
  style,
}: {
  doc: string;
  config: FrameConfig;
  width: number | string;
  height: number | string;
  title: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  // The name is fixed at mount so a theme change does not reload the frame and lose its state.
  const [name] = useState(() => frameName(config));
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: "proto:theme", theme: config.theme }, "*");
  }, [config.theme]);
  useEffect(() => {
    if (config.controls)
      ref.current?.contentWindow?.postMessage(
        { type: "proto:controls", controls: config.controls },
        "*",
      );
  }, [config.controls]);
  return (
    <iframe
      ref={ref}
      name={name}
      title={title}
      srcDoc={doc}
      className={className}
      style={{ width, height, border: 0, display: "block", ...style }}
    />
  );
}

function useInView<T extends Element>(eager: boolean) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(eager);
  useEffect(() => {
    if (inView || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "600px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [inView]);
  return [ref, inView] as const;
}

function useWidth<T extends Element>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function frameSize(frame: Frame, fallback: Viewport) {
  const viewport = frame.viewport ?? fallback;
  const size = viewportSize[viewport];
  return { viewport, width: size.width, height: frame.height ?? size.height };
}

function StatusBadge({ status }: { status?: FrameStatus }) {
  if (status?.errors.length) return <Badge tone="danger">エラー {status.errors.length}</Badge>;
  if (!status?.ready) return <Badge>読み込み中</Badge>;
  if (status.warnings.length) return <Badge tone="warning">警告 {status.warnings.length}</Badge>;
  return null;
}

function FrameCard({
  frame,
  fallback,
  doc,
  theme,
  eager,
  status,
  onOpen,
}: {
  frame: Frame;
  fallback: Viewport;
  doc: string;
  theme: Theme;
  eager: boolean;
  status?: FrameStatus;
  onOpen: () => void;
}) {
  const { viewport, width, height } = frameSize(frame, fallback);
  const [inViewRef, inView] = useInView<HTMLDivElement>(eager);
  const [boxRef, boxWidth] = useWidth<HTMLDivElement>();
  const scale = boxWidth ? boxWidth / width : 0;
  return (
    <figure
      className="m-0 flex min-w-0 flex-col gap-2"
      style={{ width: viewport === "mobile" ? "min(100%, 260px)" : "min(100%, 560px)" }}
    >
      <figcaption className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{frame.state}</span>
        <StatusBadge status={status} />
        <span className="ml-auto text-muted text-xs">
          {viewport === "mobile" ? "モバイル" : "デスクトップ"}
        </span>
      </figcaption>
      <div ref={inViewRef}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${frame.screen} — ${frame.state} を拡大`}
          className="block w-full cursor-zoom-in overflow-hidden rounded-md border border-border bg-background p-0 text-left shadow-sm"
        >
          <div ref={boxRef} className="relative w-full" style={{ height: height * scale }}>
            {inView && scale > 0 && (
              <FrameView
                doc={doc}
                config={{ target: frame.id, theme }}
                width={width}
                height={height}
                title={`${frame.screen} — ${frame.state}`}
                className="pointer-events-none absolute top-0 left-0 origin-top-left"
                style={{ transform: `scale(${scale})` }}
              />
            )}
          </div>
        </button>
      </div>
      {frame.note && <p className="m-0 text-muted text-sm">{frame.note}</p>}
    </figure>
  );
}

function Board({
  prototype,
  doc,
  theme,
  eager,
  status,
  onOpen,
}: {
  prototype: Prototype;
  doc: string;
  theme: Theme;
  eager: boolean;
  status: Record<string, FrameStatus>;
  onOpen: (id: string) => void;
}) {
  const screens = useMemo(() => {
    const groups = new Map<string, Frame[]>();
    for (const frame of prototype.frames) {
      groups.set(frame.screen, [...(groups.get(frame.screen) ?? []), frame]);
    }
    return [...groups];
  }, [prototype.frames]);
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-10 px-4 py-6 md:px-8">
      {screens.map(([screen, frames]) => (
        <section key={screen} className="flex flex-col gap-4" aria-label={screen}>
          <h2 className="m-0 font-semibold text-xl">{screen}</h2>
          <div className="flex flex-wrap items-start gap-6">
            {frames.map((frame) => (
              <FrameCard
                key={frame.id}
                frame={frame}
                fallback={prototype.viewport ?? "desktop"}
                doc={doc}
                theme={theme}
                eager={eager}
                status={status[frame.id]}
                onOpen={() => onOpen(frame.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FocusDialog({
  prototype,
  frameId,
  doc,
  theme,
  onClose,
}: {
  prototype: Prototype;
  frameId: string | null;
  doc: string;
  theme: Theme;
  onClose: () => void;
}) {
  const frame = prototype.frames.find((item) => item.id === frameId);
  const size = frame ? frameSize(frame, prototype.viewport ?? "desktop") : null;
  return (
    <Dialog open={Boolean(frame)} onOpenChange={(open) => !open && onClose()}>
      {frame && size && (
        <DialogContent className="flex h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-none flex-col gap-3">
          <div className="pr-12">
            <DialogTitle>
              {frame.screen} — {frame.state}
            </DialogTitle>
            <DialogDescription>
              {frame.note ?? "この状態を実寸で表示しています。"}
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background">
            <FrameView
              doc={doc}
              config={{ target: frame.id, theme }}
              width={size.width}
              height={size.height}
              title={`${frame.screen} — ${frame.state}`}
              style={{ margin: "0 auto" }}
            />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function describeStep(step: FlowStep, prototype: Prototype) {
  if ("click" in step) return `「${step.click}」を押す`;
  if ("fill" in step) return `「${step.fill}」に「${step.value}」と入力する`;
  if ("select" in step) return `「${step.select}」で「${step.option}」を選ぶ`;
  if ("press" in step) return `${step.press} キーを押す`;
  if ("expect" in step) return `「${step.expect}」が表示される`;
  const control = prototype.controls?.find((item) => item.id === step.control);
  const option = control?.options.find((item) => item.value === step.value);
  return `${control?.label ?? step.control}を「${option?.label ?? step.value}」に切り替える`;
}

/** The main flows, listed for reviewers so they know what to try. */
function Scenarios({ prototype }: { prototype: Prototype }) {
  if (!prototype.flows?.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <ListChecks size={16} aria-hidden="true" />
          シナリオ
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70dvh] w-[min(92vw,420px)] overflow-auto">
        <div className="flex flex-col gap-4">
          {prototype.flows.map((flow) => (
            <section key={flow.name} className="flex flex-col gap-1">
              <h2 className="m-0 font-semibold text-sm">{flow.name}</h2>
              <ol className="m-0 list-decimal pl-5 text-muted text-sm">
                {flow.steps.map((step, index) => (
                  // Steps have no identity besides their position.
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  <li key={index}>{describeStep(step, prototype)}</li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Play({
  prototype,
  doc,
  theme,
  viewport,
  onViewport,
}: {
  prototype: Prototype;
  doc: string;
  theme: Theme;
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
}) {
  const mobile = viewportSize.mobile;
  const [controls, setControls] = useState<ControlValues>(() => initialControls(prototype));
  const [resetKey, setResetKey] = useState(0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-b bg-surface px-4 py-2">
        <ToggleGroup
          type="single"
          value={viewport}
          onValueChange={(value) => value && onViewport(value as Viewport)}
          aria-label="画面幅"
        >
          <ToggleGroupItem value="desktop" aria-label="デスクトップ">
            <Monitor size={16} aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="モバイル">
            <Smartphone size={16} aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
        {prototype.controls?.map((control) => (
          <div key={control.id} className="flex items-center gap-2">
            <span className="text-muted text-sm">{control.label}</span>
            <ToggleGroup
              type="single"
              value={controls[control.id]}
              onValueChange={(value) => value && setControls({ ...controls, [control.id]: value })}
              aria-label={control.label}
            >
              {control.options.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="px-3 text-sm">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Scenarios prototype={prototype} />
          <Button variant="ghost" size="sm" onClick={() => setResetKey((key) => key + 1)}>
            <RotateCcw size={16} aria-hidden="true" />
            最初から
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-background">
        <FrameView
          key={`${viewport}-${resetKey}`}
          doc={doc}
          config={{ target: "app", theme, controls }}
          width={viewport === "mobile" ? mobile.width : "100%"}
          height={viewport === "mobile" ? mobile.height : "100%"}
          title="操作できるプロトタイプ"
          className={viewport === "mobile" ? "my-6 shrink-0 rounded-lg shadow-md" : undefined}
        />
      </div>
    </div>
  );
}

function Spec({ html }: { html: string }) {
  return (
    <article
      className="proto-spec mx-auto max-w-[880px] px-4 py-8 md:px-8"
      // spec.md is the author's own document, converted at build time.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time markdown
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function Shell({ prototype }: { prototype: Prototype }) {
  const doc = useFrameDocument();
  const initial = useMemo(readHash, []);
  const specHtml = useMemo(
    () => (document.getElementById("proto-spec") as HTMLTemplateElement | null)?.innerHTML ?? "",
    [],
  );
  const [view, setView] = useState<View>(
    initial.view === "spec" && !specHtml ? "board" : initial.view,
  );
  const [focus, setFocus] = useState<string | null>(initial.frame);
  const [theme, setTheme] = useState<Theme>(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [viewport, setViewport] = useState<Viewport>(prototype.viewport ?? "desktop");
  // The interactive App loads on first visit, then stays mounted to keep its state across tabs.
  const [played, setPlayed] = useState(initial.view === "play");
  const status = useFrameStatus(prototype);

  useEffect(() => writeHash(view, focus), [view, focus]);
  useEffect(() => {
    if (view === "play") setPlayed(true);
  }, [view]);
  useEffect(() => {
    document.title = prototype.title;
  }, [prototype.title]);

  return (
    <ThemeProvider forcedTheme={theme} storageKey="gdg-prototype-theme">
      <Tabs
        value={view}
        onValueChange={(value) => setView(value as View)}
        className="flex h-dvh flex-col bg-background text-foreground"
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-b bg-surface px-4 py-2">
          <div className="min-w-0 flex-1 basis-60">
            <h1 className="m-0 truncate font-semibold text-base">{prototype.title}</h1>
            {prototype.summary && (
              <p className="m-0 truncate text-muted text-xs">{prototype.summary}</p>
            )}
          </div>
          <TabsList aria-label="表示">
            <TabsTrigger value="board">画面一覧</TabsTrigger>
            <TabsTrigger value="play">操作</TabsTrigger>
            {specHtml && <TabsTrigger value="spec">仕様</TabsTrigger>}
          </TabsList>
          <IconButton
            aria-label={theme === "dark" ? "ライトにする" : "ダークにする"}
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <Moon size={16} aria-hidden="true" />
            ) : (
              <Sun size={16} aria-hidden="true" />
            )}
          </IconButton>
        </header>
        <TabsContent
          value="board"
          forceMount
          className="m-0 min-h-0 flex-1 p-0 overflow-auto data-[state=inactive]:hidden"
        >
          <Board
            prototype={prototype}
            doc={doc}
            theme={theme}
            eager={initial.eager}
            status={status}
            onOpen={setFocus}
          />
        </TabsContent>
        <TabsContent
          value="play"
          forceMount
          className="m-0 min-h-0 flex-1 p-0 data-[state=inactive]:hidden"
        >
          {played && (
            <Play
              prototype={prototype}
              doc={doc}
              theme={theme}
              viewport={viewport}
              onViewport={setViewport}
            />
          )}
        </TabsContent>
        {specHtml && (
          <TabsContent value="spec" className="m-0 min-h-0 flex-1 p-0 overflow-auto">
            <Spec html={specHtml} />
          </TabsContent>
        )}
      </Tabs>
      <FocusDialog
        prototype={prototype}
        frameId={focus}
        doc={doc}
        theme={theme}
        onClose={() => setFocus(null)}
      />
    </ThemeProvider>
  );
}
