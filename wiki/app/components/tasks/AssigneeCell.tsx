import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface Member {
  id: string;
  name: string;
  image: string | null;
}

interface AssigneeCellProps {
  assigneeId: string | null;
  assigneeName: string | null;
  members: Member[];
  onChange: (update: { assigneeId: string | null; assigneeName: string | null }) => void;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

function Initials({ name, blue }: { name: string; blue?: boolean }) {
  const initial = name.slice(0, 1).toUpperCase();
  return (
    <div
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
        blue ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
      }`}
    >
      {initial}
    </div>
  );
}

export default function AssigneeCell({
  assigneeId,
  assigneeName,
  members,
  onChange,
}: AssigneeCellProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const assignedMember = assigneeId ? members.find((m) => m.id === assigneeId) : null;

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
        width: Math.max(rect.width, 180),
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
          width: Math.max(rect.width, 180),
        });
      }
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  const trimmedSearch = search.trim();
  const filteredMembers = trimmedSearch
    ? members.filter((m) => m.name.toLowerCase().includes(trimmedSearch.toLowerCase()))
    : members;
  const showUseAs = trimmedSearch.length > 0 && filteredMembers.length === 0;

  function select(update: { assigneeId: string | null; assigneeName: string | null }) {
    onChange(update);
    setOpen(false);
    setSearch("");
  }

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: "absolute", top: pos.top, left: pos.left, minWidth: pos.width }}
            className="z-[9999] overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
          >
            {/* Search input */}
            <div className="border-b border-gray-100 px-2 py-1.5">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("tasks.filter_assignee")}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (showUseAs) {
                      select({ assigneeId: null, assigneeName: trimmedSearch });
                    } else if (filteredMembers.length > 0) {
                      select({ assigneeId: filteredMembers[0].id, assigneeName: null });
                    }
                  }
                }}
              />
            </div>
            <div className="py-1">
              {/* Clear option */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  select({ assigneeId: null, assigneeName: null });
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" />
                <span>—</span>
              </button>

              {/* Registered members */}
              {filteredMembers.map((m) => {
                const isSelected = m.id === assigneeId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      select({ assigneeId: m.id, assigneeName: null });
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      isSelected ? "font-medium text-gray-900" : "text-gray-700"
                    } hover:bg-gray-50`}
                  >
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" />
                    {m.image ? (
                      <img
                        src={m.image}
                        alt=""
                        className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Initials name={m.name} blue />
                    )}
                    <span className="truncate">{m.name}</span>
                  </button>
                );
              })}

              {/* "Use as assignee" synthetic row */}
              {showUseAs && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    select({ assigneeId: null, assigneeName: trimmedSearch });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm italic text-gray-500 hover:bg-gray-50"
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" />
                  {t("tasks.use_as_assignee", { name: trimmedSearch })}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  // Trigger label
  let triggerContent: React.ReactNode;
  if (assignedMember) {
    triggerContent = (
      <>
        {assignedMember.image ? (
          <img
            src={assignedMember.image}
            alt=""
            className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <Initials name={assignedMember.name} blue />
        )}
        <span className="max-w-[60px] truncate">{assignedMember.name}</span>
      </>
    );
  } else if (assigneeName) {
    triggerContent = (
      <>
        <Initials name={assigneeName} />
        <span className="max-w-[60px] truncate">{assigneeName}</span>
      </>
    );
  } else {
    triggerContent = <span className="max-w-[60px] truncate text-gray-400">—</span>;
  }

  return (
    <div className="relative min-w-0 overflow-hidden">
      <button
        ref={triggerRef}
        type="button"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-sm hover:bg-gray-100"
        onClick={openMenu}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {triggerContent}
        <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
      </button>
      {menu}
    </div>
  );
}
