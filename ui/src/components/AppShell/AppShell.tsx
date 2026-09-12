import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "../Sheet";

export function AppShell({
  navigation,
  header,
  children,
  brand,
  navigationLabel = "ナビゲーション",
}: {
  navigation: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  brand: ReactNode;
  navigationLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gdg-shell">
      <a className="gdg-skip-link" href="#gdg-main">
        本文へ移動
      </a>
      <aside className="gdg-sidebar">
        <div className="gdg-brand">{brand}</div>
        {navigation}
      </aside>
      <div className="gdg-shell-body">
        <header className="gdg-shell-header">
          <div className="gdg-mobile-only">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <IconButton variant="ghost" aria-label={navigationLabel}>
                  <Menu size={20} />
                </IconButton>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>{navigationLabel}</SheetTitle>
                <SheetDescription>移動先を選択してください。</SheetDescription>
                <div
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) setOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.target as HTMLElement).closest("a")) setOpen(false);
                  }}
                >
                  {navigation}
                </div>
                <SheetClose asChild>
                  <Button variant="outline">閉じる</Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
          </div>
          {header}
        </header>
        <main id="gdg-main" tabIndex={-1} className="gdg-main">
          {children}
        </main>
      </div>
    </div>
  );
}
