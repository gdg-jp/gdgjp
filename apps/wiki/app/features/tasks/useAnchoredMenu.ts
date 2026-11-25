import { useEventListener } from "@gdgjp/gdg-lib/react";
import { useCallback, useRef, useState } from "react";

const focusOnAttach = (element: HTMLInputElement | null) => element?.focus();

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

interface UseAnchoredMenuResult {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: (element: HTMLInputElement | null) => void;
  pos: MenuPosition | null;
  open: boolean;
  search: string;
  setSearch: (value: string) => void;
  openMenu: (e: React.MouseEvent) => void;
  close: () => void;
}

export function useAnchoredMenu(): UseAnchoredMenuResult {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function calcPos(): MenuPosition | null {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 160),
    };
  }

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const p = calcPos();
    if (p) setPos(p);
    setSearch("");
    setOpen(true);
  }

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  useEventListener("document", "mousedown", (e) => {
    if (!open) return;
    const target = e.target as Node;
    if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
    close();
  });

  useEventListener("document", "keydown", (e) => {
    if (open && e.key === "Escape") close();
  });

  useEventListener(
    "window",
    "scroll",
    () => {
      if (!open) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, 160),
      });
    },
    { capture: true },
  );

  const searchInputRef = focusOnAttach;

  return { triggerRef, menuRef, searchInputRef, pos, open, search, setSearch, openMenu, close };
}
