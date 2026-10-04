import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Tag } from "~/features/tags/tag-record";

export function TagCombobox({
  availableTags,
  selectedIds,
  newTagNames,
  onChange,
  disabled,
}: {
  availableTags: Tag[];
  selectedIds: number[];
  newTagNames: string[];
  onChange: (ids: number[], newNames: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = "tag-combobox-listbox";
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const tagById = useMemo(() => {
    const m = new Map<number, Tag>();
    for (const t of availableTags) m.set(t.id, t);
    return m;
  }, [availableTags]);

  const selectedTags: Tag[] = selectedIds.map((id) => tagById.get(id)).filter((t): t is Tag => !!t);
  const selectedNames = new Set([
    ...selectedTags.map((t) => t.name.toLowerCase()),
    ...newTagNames.map((n) => n.toLowerCase()),
  ]);

  const trimmed = query.trim();
  const lowerQuery = trimmed.toLowerCase();
  const filteredAvailable = availableTags.filter(
    (t) => !selectedIds.includes(t.id) && t.name.toLowerCase().includes(lowerQuery),
  );
  const exactMatchExists = availableTags.some((t) => t.name.toLowerCase() === lowerQuery);
  const showCreate = trimmed.length > 0 && trimmed.length <= 32 && !selectedNames.has(lowerQuery);

  function addExisting(tag: Tag) {
    onChange([...selectedIds, tag.id], newTagNames);
    setQuery("");
    inputRef.current?.focus();
  }

  function addNew(name: string) {
    const n = name.trim();
    if (!n || selectedNames.has(n.toLowerCase())) return;
    onChange(selectedIds, [...newTagNames, n]);
    setQuery("");
    inputRef.current?.focus();
  }

  function removeSelectedId(id: number) {
    onChange(
      selectedIds.filter((x) => x !== id),
      newTagNames,
    );
  }

  function removeNewName(name: string) {
    onChange(
      selectedIds,
      newTagNames.filter((x) => x !== name),
    );
  }

  const showCreateOption = showCreate && !exactMatchExists;
  const totalOptions = filteredAvailable.length + (showCreateOption ? 1 : 0);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (totalOptions === 0 ? -1 : (i + 1) % totalOptions));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (totalOptions === 0 ? -1 : i <= 0 ? totalOptions - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredAvailable.length) {
        addExisting(filteredAvailable[activeIndex]);
      } else if (activeIndex === filteredAvailable.length && showCreateOption) {
        addNew(trimmed);
      } else {
        const match = availableTags.find(
          (t) => !selectedIds.includes(t.id) && t.name.toLowerCase() === lowerQuery,
        );
        if (match) addExisting(match);
        else if (filteredAvailable.length > 0 && !showCreate) addExisting(filteredAvailable[0]);
        else if (showCreate) addNew(trimmed);
      }
    } else if (e.key === "Backspace" && query === "") {
      if (newTagNames.length > 0) {
        removeNewName(newTagNames[newTagNames.length - 1]);
      } else if (selectedIds.length > 0) {
        removeSelectedId(selectedIds[selectedIds.length - 1]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm ${
          disabled ? "opacity-60" : "focus-within:ring-2 focus-within:ring-ring/40"
        }`}
      >
        {selectedTags.map((tag) => (
          <Chip key={`s-${tag.id}`} onRemove={() => removeSelectedId(tag.id)} disabled={disabled}>
            {tag.name}
          </Chip>
        ))}
        {newTagNames.map((name) => (
          <Chip key={`n-${name}`} onRemove={() => removeNewName(name)} disabled={disabled} isNew>
            {name}
          </Chip>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0
              ? activeIndex < filteredAvailable.length
                ? `tag-option-${filteredAvailable[activeIndex].id}`
                : "tag-option-create"
              : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={
            selectedTags.length === 0 && newTagNames.length === 0 ? "Search or add tags..." : ""
          }
          disabled={disabled}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && !disabled ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Available tags"
          tabIndex={-1}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {filteredAvailable.length === 0 && !showCreateOption ? (
            <p className="px-2 py-1.5 text-muted-foreground">No tags found.</p>
          ) : null}
          {filteredAvailable.map((tag, idx) => (
            <button
              type="button"
              role="option"
              aria-selected={idx === activeIndex}
              id={`tag-option-${tag.id}`}
              key={tag.id}
              onClick={() => addExisting(tag)}
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left hover:bg-accent${idx === activeIndex ? " bg-accent" : ""}`}
            >
              <span>{tag.name}</span>
            </button>
          ))}
          {showCreateOption ? (
            <button
              type="button"
              role="option"
              aria-selected={activeIndex === filteredAvailable.length}
              id="tag-option-create"
              onClick={() => addNew(trimmed)}
              className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left hover:bg-accent${activeIndex === filteredAvailable.length ? " bg-accent" : ""}`}
            >
              <Plus className="size-3.5 text-muted-foreground" />
              <span>
                Create <span className="font-medium">"{trimmed}"</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  children,
  onRemove,
  disabled,
  isNew,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  disabled?: boolean;
  isNew?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs ${
        isNew ? "border-dashed bg-muted" : "bg-secondary"
      }`}
    >
      <span>{children}</span>
      {!disabled ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove tag"
          className="rounded text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
