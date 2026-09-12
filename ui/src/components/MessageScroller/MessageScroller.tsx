import { ArrowDown, ArrowUp } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../utils";
import { Button, type ButtonProps } from "../Button";

type MessageScrollerContextValue = {
  viewport: HTMLDivElement | null;
  setViewport: (node: HTMLDivElement | null) => void;
  atStart: boolean;
  atEnd: boolean;
  scrollTo: (position: "start" | "end") => void;
  scrollToMessage: (messageId: string) => void;
};

const MessageScrollerContext = createContext<MessageScrollerContextValue | null>(null);

function useMessageScrollerContext() {
  const context = useContext(MessageScrollerContext);
  if (!context)
    throw new Error("MessageScroller parts must be used inside MessageScrollerProvider");
  return context;
}

export function MessageScrollerProvider({
  initialPosition = "end",
  follow = false,
  children,
}: {
  initialPosition?: "start" | "end";
  follow?: boolean;
  children: ReactNode;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const initialised = useRef(false);
  const update = useCallback(() => {
    if (!viewport) return;
    setAtStart(viewport.scrollTop <= 1);
    setAtEnd(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1);
  }, [viewport]);
  const scrollTo = useCallback(
    (position: "start" | "end") => {
      viewport?.scrollTo({
        top: position === "start" ? 0 : viewport.scrollHeight,
        behavior: "smooth",
      });
    },
    [viewport],
  );
  const scrollToMessage = useCallback((messageId: string) => {
    document.getElementById(messageId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!viewport) return;
    viewport.addEventListener("scroll", update, { passive: true });
    update();
    if (!initialised.current) {
      viewport.scrollTop = initialPosition === "end" ? viewport.scrollHeight : 0;
      initialised.current = true;
      update();
    }
    return () => viewport.removeEventListener("scroll", update);
  }, [initialPosition, update, viewport]);

  useEffect(() => {
    if (!viewport) return;
    const handleContentChange = () => {
      const wasAtEnd = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
      update();
      if (follow && wasAtEnd) {
        window.requestAnimationFrame(() => scrollTo("end"));
      }
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(handleContentChange);
    resizeObserver?.observe(viewport);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(handleContentChange);
    mutationObserver?.observe(viewport, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [follow, scrollTo, update, viewport]);

  return (
    <MessageScrollerContext.Provider
      value={{ viewport, setViewport, atStart, atEnd, scrollTo, scrollToMessage }}
    >
      <MessageScrollerFollow follow={follow} />
      {children}
    </MessageScrollerContext.Provider>
  );
}

function MessageScrollerFollow({ follow }: { follow: boolean }) {
  const context = useMessageScrollerContext();
  useEffect(() => {
    if (follow && context.atEnd) context.scrollTo("end");
  }, [context.atEnd, context.scrollTo, follow]);
  return null;
}

export function MessageScroller({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-message-scroller", className)} />;
}

export function MessageScrollerViewport({
  ref,
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  const context = useMessageScrollerContext();
  const setRef = (node: HTMLDivElement | null) => {
    context.setViewport(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <div
      {...props}
      ref={setRef}
      tabIndex={props.tabIndex ?? 0}
      role={props.role ?? "log"}
      className={cn("gdg-message-scroller-viewport", className)}
    >
      {children}
    </div>
  );
}

export function MessageScrollerContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      aria-live={props["aria-live"] ?? "polite"}
      className={cn("gdg-message-scroller-content", className)}
    />
  );
}

export function MessageScrollerItem({
  messageId,
  scrollAnchor,
  className,
  ...props
}: ComponentProps<"div"> & { messageId?: string; scrollAnchor?: boolean }) {
  return (
    <div
      {...props}
      id={messageId}
      data-scroll-anchor={scrollAnchor || undefined}
      className={cn("gdg-message-scroller-item", className)}
    />
  );
}

export function MessageScrollerButton({
  to = "end",
  children,
  className,
  ...props
}: ButtonProps & { to?: "start" | "end" }) {
  const context = useMessageScrollerContext();
  const disabled = to === "end" ? context.atEnd : context.atStart;
  return (
    <Button
      {...props}
      type={props.type ?? "button"}
      variant={props.variant ?? "outline"}
      size={props.size ?? "sm"}
      disabled={props.disabled ?? disabled}
      aria-label={props["aria-label"] ?? (to === "end" ? "最新へ移動" : "先頭へ移動")}
      className={cn("gdg-message-scroller-button", className)}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) context.scrollTo(to);
      }}
    >
      {children ??
        (to === "end" ? (
          <ArrowDown size={16} aria-hidden="true" />
        ) : (
          <ArrowUp size={16} aria-hidden="true" />
        ))}
    </Button>
  );
}
