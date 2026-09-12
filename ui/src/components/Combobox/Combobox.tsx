import { Check } from "lucide-react";
import { type ComponentProps, createContext, useContext, useId, useState } from "react";
import { cn } from "../../utils";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";

type ComboboxContextValue = {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  value?: string;
  setValue: (value: string) => void;
  close: () => void;
  listId: string;
};

const ComboboxContext = createContext<ComboboxContextValue | null>(null);
const optionRole = "option" as const;

function useCombobox() {
  const context = useContext(ComboboxContext);
  if (!context) throw new Error("Combobox parts must be used inside Combobox");
  return context;
}

export function Combobox({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  value,
  defaultValue,
  onValueChange,
  children,
}: ComponentProps<typeof Popover> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const listId = `gdg-combobox-list-${useId().replace(/:/g, "")}`;
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };
  return (
    <ComboboxContext.Provider
      value={{
        open,
        query,
        setQuery,
        value: value ?? internalValue,
        setValue,
        close: () => setOpen(false),
        listId,
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        {children}
      </Popover>
    </ComboboxContext.Provider>
  );
}

export function ComboboxTrigger({ className, ...props }: ComponentProps<typeof PopoverTrigger>) {
  const context = useCombobox();
  return (
    <PopoverTrigger
      {...props}
      aria-haspopup="listbox"
      aria-expanded={context.open}
      className={cn("gdg-combobox-trigger", className)}
    />
  );
}

export function ComboboxContent({ className, ...props }: ComponentProps<typeof PopoverContent>) {
  return <PopoverContent {...props} className={cn("gdg-combobox-content", className)} />;
}

export function ComboboxInput({ className, ...props }: ComponentProps<"input">) {
  const context = useCombobox();
  return (
    <input
      {...props}
      value={props.value ?? context.query}
      aria-label={props["aria-label"] ?? "候補を検索"}
      role="combobox"
      aria-controls={context.listId}
      aria-expanded={context.open}
      aria-autocomplete="list"
      className={cn("gdg-input", "gdg-combobox-input", className)}
      onChange={(event) => {
        context.setQuery(event.target.value);
        props.onChange?.(event);
      }}
    />
  );
}

export function ComboboxList({ className, ...props }: ComponentProps<"div">) {
  const context = useCombobox();
  return (
    <div
      {...props}
      id={props.id ?? context.listId}
      role={props.role ?? "listbox"}
      className={cn("gdg-combobox-list", className)}
    />
  );
}

export function ComboboxEmpty({
  className,
  children = "候補がありません。",
  ...props
}: ComponentProps<"div">) {
  return (
    <div {...props} className={cn("gdg-combobox-empty", className)}>
      {children}
    </div>
  );
}

export function ComboboxGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div {...props} role={props.role ?? "group"} className={cn("gdg-combobox-group", className)} />
  );
}

export function ComboboxItem({
  value,
  keywords = [],
  className,
  children,
  onSelect,
  ...props
}: ComponentProps<"button"> & {
  value: string;
  keywords?: string[];
  onSelect?: (value: string) => void;
}) {
  const context = useCombobox();
  const query = context.query.toLowerCase();
  const visible = !query || `${value} ${keywords.join(" ")}`.toLowerCase().includes(query);
  const selected = context.value === value;
  return (
    <div
      aria-hidden={visible ? undefined : true}
      inert={visible ? undefined : true}
      data-combobox-hidden={visible ? undefined : "true"}
      className="gdg-combobox-item-shell"
    >
      <button
        {...props}
        type={props.type ?? "button"}
        role={optionRole}
        aria-hidden={visible ? undefined : true}
        aria-selected={selected}
        tabIndex={visible ? props.tabIndex : -1}
        className={cn("gdg-combobox-item", className)}
        onClick={(event) => {
          onSelect?.(value);
          context.setValue(value);
          context.close();
          props.onClick?.(event);
        }}
      >
        <span>{children}</span>
        {selected && <Check size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
