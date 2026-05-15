import { ListFilter } from "lucide-react";
import { createPortal } from "react-dom";
import { useAnchoredMenu } from "./useAnchoredMenu";

interface Option {
  value: string;
  label: string;
  dot?: string;
}

interface ColumnFilterPopoverProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export default function ColumnFilterPopover({
  label,
  options,
  selected,
  onChange,
  searchable,
  searchPlaceholder,
}: ColumnFilterPopoverProps) {
  const { triggerRef, menuRef, searchInputRef, pos, open, search, setSearch, openMenu } =
    useAnchoredMenu({ searchable });

  const isActive = selected.length > 0;

  function toggleOption(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const allSelected = selected.length === 0;
  const visibleOptions =
    searchable && search.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
      : options;

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: "absolute", top: pos.top, left: pos.left, minWidth: pos.width }}
            className="z-[9999] overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
          >
            {searchable && (
              <div className="border-b border-gray-100 px-2 py-1.5">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onChange([])}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                All
              </label>
              {!allSelected && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {visibleOptions.map((opt) => {
                const isChecked = selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleOption(opt.value)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {opt.dot && (
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: opt.dot }}
                      />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        className={`relative inline-flex items-center rounded p-0.5 hover:bg-gray-200 ${
          isActive ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
        }`}
        aria-label={`Filter by ${label}`}
      >
        <ListFilter size={12} />
        {isActive && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">
            {selected.length}
          </span>
        )}
      </button>
      {menu}
    </>
  );
}
