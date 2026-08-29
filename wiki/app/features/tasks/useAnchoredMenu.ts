import { useCallback, useEffect, useRef, useState } from "react";

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

interface UseAnchoredMenuOptions {
  searchable?: boolean;
}

interface UseAnchoredMenuResult {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  pos: MenuPosition | null;
  open: boolean;
  search: string;
  setSearch: (value: string) => void;
  openMenu: (e: React.MouseEvent) => void;
  close: () => void;
}

export function useAnchoredMenu({
  searchable,
}: UseAnchoredMenuOptions = {}): UseAnchoredMenuResult {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    if (searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, close]);

  // Reposition on scroll while open
  useEffect(() => {
    if (!open) return;
    function handleScroll() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, 160),
      });
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  return { triggerRef, menuRef, searchInputRef, pos, open, search, setSearch, openMenu, close };
}
