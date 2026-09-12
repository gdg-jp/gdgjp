import { Search } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../Dialog";

type CommandItemRecord = {
  id: string;
  value: string;
  keywords: string[];
  disabled: boolean;
  ref: HTMLButtonElement | null;
};

type CommandContextValue = {
  query: string;
  setQuery: (value: string) => void;
  shouldFilter: boolean;
  activeValue?: string;
  setActiveValue: (value: string) => void;
  registerItem: (item: CommandItemRecord) => void;
  unregisterItem: (id: string) => void;
  selectItem: (value: string) => void;
  itemCount: number;
  listId: string;
};

const CommandContext = createContext<CommandContextValue | null>(null);
const optionRole = "option" as const;

function useCommandContext() {
  const context = useContext(CommandContext);
  if (!context) throw new Error("Command parts must be used inside Command");
  return context;
}

export function Command({
  value,
  defaultValue = "",
  onValueChange,
  shouldFilter = true,
  className,
  children,
  onKeyDown,
  ...props
}: ComponentProps<"div"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  shouldFilter?: boolean;
}) {
  const [internalQuery, setInternalQuery] = useState(defaultValue);
  const query = value ?? internalQuery;
  const [hasFiltered, setHasFiltered] = useState(() => Boolean(defaultValue || value));
  const [items, setItems] = useState<CommandItemRecord[]>([]);
  const [activeValue, setActiveValue] = useState<string>();
  const listId = useId();
  const setQuery = (next: string) => {
    if (next !== query) setHasFiltered(true);
    if (value === undefined) setInternalQuery(next);
    onValueChange?.(next);
  };
  useEffect(() => {
    if (query) setHasFiltered(true);
  }, [query]);
  const registerItem = useCallback((item: CommandItemRecord) => {
    setItems((current) => {
      const index = current.findIndex((candidate) => candidate.id === item.id);
      if (index === -1) return [...current, item];
      const previous = current[index];
      if (
        previous?.value === item.value &&
        previous?.disabled === item.disabled &&
        previous?.ref === item.ref &&
        previous?.keywords.length === item.keywords.length &&
        previous.keywords.every((keyword, keywordIndex) => keyword === item.keywords[keywordIndex])
      )
        return current;
      const next = current.slice();
      next[index] = item;
      return next;
    });
  }, []);
  const unregisterItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !item.disabled &&
          (!shouldFilter ||
            !query ||
            `${item.value} ${item.keywords.join(" ")}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [items, query, shouldFilter],
  );
  const selectItem = (selectedValue: string) => {
    setActiveValue(selectedValue);
    const item = items.find((candidate) => candidate.value === selectedValue);
    item?.ref?.click();
  };
  const moveActive = (direction: -1 | 1) => {
    if (!visibleItems.length) return;
    const current = Math.max(
      visibleItems.findIndex((item) => item.value === activeValue),
      0,
    );
    const next = visibleItems[(current + direction + visibleItems.length) % visibleItems.length];
    if (!next) return;
    setActiveValue(next.value);
    next.ref?.focus();
  };

  return (
    <CommandContext.Provider
      value={{
        query,
        setQuery,
        shouldFilter,
        activeValue,
        setActiveValue,
        registerItem,
        unregisterItem,
        selectItem,
        itemCount: visibleItems.length,
        listId,
      }}
    >
      <div
        {...props}
        data-command="true"
        data-command-filtered={hasFiltered || query ? "true" : undefined}
        tabIndex={props.tabIndex ?? -1}
        className={cn("gdg-command", className)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveActive(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveActive(-1);
          } else if (event.key === "Home") {
            event.preventDefault();
            visibleItems[0]?.ref?.focus();
            if (visibleItems[0]) setActiveValue(visibleItems[0].value);
          } else if (event.key === "End") {
            event.preventDefault();
            const last = visibleItems.at(-1);
            last?.ref?.focus();
            if (last) setActiveValue(last.value);
          } else if (event.key === "Enter" && activeValue) {
            event.preventDefault();
            selectItem(activeValue);
          }
          onKeyDown?.(event);
        }}
        aria-label={props["aria-label"] ?? "コマンド"}
      >
        {children}
      </div>
      <span className="gdg-sr-only" aria-live="polite">
        {visibleItems.length} 件の候補
      </span>
    </CommandContext.Provider>
  );
}

export function CommandInput({
  ref,
  className,
  value,
  defaultValue,
  onChange,
  ...props
}: ComponentProps<"input">) {
  const context = useCommandContext();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <div className="gdg-command-input-wrap">
      <Search size={16} aria-hidden="true" />
      <input
        {...props}
        ref={setRef}
        value={value ?? context.query}
        defaultValue={value === undefined ? undefined : defaultValue}
        aria-label={props["aria-label"] ?? "検索"}
        aria-controls={context.listId}
        aria-expanded="true"
        aria-autocomplete="list"
        role="combobox"
        className={cn("gdg-command-input", className)}
        onChange={(event) => {
          context.setQuery(event.target.value);
          onChange?.(event);
        }}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<"div">) {
  const context = useCommandContext();
  return (
    <div
      {...props}
      id={props.id ?? context.listId}
      role={props.role ?? "listbox"}
      className={cn("gdg-command-list", className)}
    />
  );
}

export function CommandEmpty({
  className,
  children = "結果がありません。",
  ...props
}: ComponentProps<"div">) {
  const context = useCommandContext();
  return (
    <div {...props} hidden={context.itemCount > 0} className={cn("gdg-command-empty", className)}>
      {children}
    </div>
  );
}

export function CommandGroup({
  heading,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { heading?: ReactNode }) {
  const headingId = useId();
  return (
    <div
      {...props}
      aria-labelledby={heading ? headingId : undefined}
      className={cn("gdg-command-group", className)}
    >
      {heading && (
        <div id={headingId} className="gdg-command-heading">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

export function CommandItem({
  value,
  keywords = [],
  disabled = false,
  className,
  children,
  onSelect,
  onFocus,
  ...props
}: ComponentProps<"button"> & {
  value: string;
  keywords?: string[];
  onSelect?: (value: string) => void;
}) {
  const context = useCommandContext();
  const { activeValue, query, registerItem, setActiveValue, shouldFilter, unregisterItem } =
    context;
  const id = useId();
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const normalizedQuery = query.toLowerCase();
  const keywordKey = keywords.join("\u0000");
  const itemKeywords = useMemo(() => (keywordKey ? keywordKey.split("\u0000") : []), [keywordKey]);
  const visible =
    !shouldFilter ||
    !normalizedQuery ||
    `${value} ${itemKeywords.join(" ")}`.toLowerCase().includes(normalizedQuery);
  useEffect(() => {
    registerItem({ id, value, keywords: itemKeywords, disabled, ref: itemRef.current });
    return () => unregisterItem(id);
  }, [disabled, id, itemKeywords, registerItem, unregisterItem, value]);
  return (
    <button
      {...props}
      ref={itemRef}
      type={props.type ?? "button"}
      role={optionRole}
      aria-selected={activeValue === value}
      aria-disabled={disabled || undefined}
      aria-hidden={visible ? undefined : true}
      disabled={disabled}
      inert={!visible ? true : undefined}
      tabIndex={visible ? props.tabIndex : -1}
      data-command-hidden={visible ? undefined : "true"}
      className={cn("gdg-command-item", className)}
      onFocus={(event) => {
        setActiveValue(value);
        onFocus?.(event);
      }}
      onMouseMove={() => setActiveValue(value)}
      onClick={(event) => {
        if (disabled) return;
        onSelect?.(value);
        props.onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}

export function CommandShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} aria-hidden="true" className={cn("gdg-command-shortcut", className)} />;
}

export function CommandSeparator({ className, ...props }: ComponentProps<"hr">) {
  return <hr {...props} className={cn("gdg-command-separator", className)} />;
}

export function CommandLoading({ className, ...props }: ComponentProps<"output">) {
  return (
    <output {...props} aria-live="polite" className={cn("gdg-command-loading", className)}>
      読み込み中…
    </output>
  );
}

export function CommandDialog({
  open,
  defaultOpen,
  onOpenChange,
  title = "コマンドパレット",
  description = "実行する操作を検索してください。",
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DialogContent className="gdg-command-dialog">
        <DialogTitle className="gdg-sr-only">{title}</DialogTitle>
        <DialogDescription className="gdg-sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
