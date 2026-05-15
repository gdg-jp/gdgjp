import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useAnchoredMenu } from "./useAnchoredMenu";

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional colored dot rendered before the label */
  dot?: string;
  /** Optional Tailwind classes applied when this option is the chip trigger */
  chipClass?: string;
  /** Optional profile image URL (used for assignee avatars) */
  image?: string | null;
}

interface DropdownMenuProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** Text to show when value is empty / no match */
  placeholder?: string;
  /** Render style: "inline" for table cells, "field" for forms, "filter" for filter bar, "chip" for colored pill */
  variant?: "inline" | "field" | "filter" | "chip";
  /** Show a search input inside the dropdown */
  searchable?: boolean;
  /** Header text shown at the top of the dropdown */
  header?: string;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Extra classes applied to the label span inside the trigger */
  labelClass?: string;
}

const triggerBase = "flex items-center gap-1 text-left text-sm";
const triggerVariants: Record<string, string> = {
  inline: `${triggerBase} rounded px-1.5 py-0.5 hover:bg-gray-100`,
  field:
    "flex w-full items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-left text-sm hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
  filter: `${triggerBase} rounded-md border border-gray-300 px-2 py-1 hover:border-gray-400`,
  chip: "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity",
};

export default function DropdownMenu({
  value,
  options,
  onChange,
  placeholder = "—",
  variant = "inline",
  searchable,
  header,
  searchPlaceholder,
  labelClass,
}: DropdownMenuProps) {
  const { triggerRef, menuRef, searchInputRef, pos, open, search, setSearch, openMenu, close } =
    useAnchoredMenu({ searchable });

  const selected = options.find((o) => o.value === value);

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
            {searchable && header && (
              <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-500">
                {header}
              </div>
            )}
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
            <div className="py-1">
              {visibleOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(opt.value);
                      close();
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      isSelected ? "font-medium text-gray-900" : "text-gray-700"
                    } hover:bg-gray-50`}
                  >
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                      {isSelected && <Check size={14} className="text-blue-600" />}
                    </span>
                    {opt.dot && (
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: opt.dot }}
                      />
                    )}
                    {opt.chipClass && (
                      <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${opt.chipClass}`} />
                    )}
                    {opt.value &&
                      opt.image !== undefined &&
                      (opt.image ? (
                        <img
                          src={opt.image}
                          alt=""
                          className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                          {opt.label.slice(0, 1).toUpperCase()}
                        </div>
                      ))}
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative min-w-0 overflow-hidden">
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerVariants[variant]}${variant === "chip" && selected?.chipClass ? ` ${selected.chipClass}` : ""}`}
        onClick={openMenu}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {selected?.dot && (
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: selected.dot }}
          />
        )}
        {selected?.value &&
          selected.image !== undefined &&
          (selected.image ? (
            <img
              src={selected.image}
              alt=""
              className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
              {selected.label.slice(0, 1).toUpperCase()}
            </div>
          ))}
        <span className={`truncate${labelClass ? ` ${labelClass}` : ""}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
      </button>

      {menu}
    </div>
  );
}
