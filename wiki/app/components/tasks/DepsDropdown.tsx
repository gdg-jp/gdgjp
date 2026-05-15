import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface DepsDropdownProps {
  taskId: string;
  value: string[];
  options: { id: string; number: number; title: string }[];
  onChange: (ids: string[]) => void;
}

interface MenuPosition {
  top: number;
  left: number;
}

export default function DepsDropdown({
  taskId: _taskId,
  value,
  options,
  onChange,
}: DepsDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
    setSearch("");
    setOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setSearch("");
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleScroll() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({
          top: rect.bottom + window.scrollY + 4,
          left: rect.left + window.scrollX,
        });
      }
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  function toggleOption(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  const q = search.trim().toLowerCase();
  const visibleOptions = q
    ? options.filter((o) => `#${o.number}`.includes(q) || o.title.toLowerCase().includes(q))
    : options;

  // Checked items first, then unchecked
  const sorted = [
    ...visibleOptions.filter((o) => value.includes(o.id)),
    ...visibleOptions.filter((o) => !value.includes(o.id)),
  ];

  const label =
    value.length > 0
      ? value
          .map((id) => options.find((o) => o.id === id))
          .filter(Boolean)
          .map((o) => `#${o?.number}`)
          .join(", ")
      : "—";

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: "absolute", top: pos.top, left: pos.left, minWidth: 220 }}
            className="z-[9999] overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
          >
            <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-500">
              {t("tasks.dependencies")}
            </div>
            <div className="border-b border-gray-100 px-2 py-1.5">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("tasks.filterPlaceholder")}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {sorted.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">{t("tasks.noTasksFound")}</div>
              ) : (
                sorted.map((opt) => {
                  const isChecked = value.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOption(opt.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="flex w-4 flex-shrink-0 items-center justify-center">
                        {isChecked && <Check size={14} className="text-blue-600" />}
                      </span>
                      <span
                        className={`flex-shrink-0 text-xs font-mono ${isChecked ? "text-blue-600" : "text-gray-400"}`}
                      >
                        #{opt.number}
                      </span>
                      <span className="truncate text-gray-700">{opt.title}</span>
                    </button>
                  );
                })
              )}
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
        className="flex items-start gap-1 rounded px-1.5 py-0.5 text-left text-sm text-gray-400 hover:bg-gray-100"
        onClick={openMenu}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span className="flex flex-col leading-tight text-xs">
          {value.length > 0 ? (
            value
              .map((id) => options.find((o) => o.id === id))
              .filter((o): o is { id: string; number: number; title: string } => o !== undefined)
              .map((o) => <span key={o.id}>#{o.number}</span>)
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </span>
        <ChevronDown size={12} className="mt-0.5 flex-shrink-0 opacity-60" />
      </button>
      {menu}
    </>
  );
}
