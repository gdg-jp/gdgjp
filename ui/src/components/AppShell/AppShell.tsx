import { Menu } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "../Sidebar";

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
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 768,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const syncSidebar = () => setSidebarOpen(media.matches);
    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  return (
    <SidebarProvider className="gdg-shell" open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <a className="gdg-skip-link" href="#gdg-main">
        本文へ移動
      </a>
      <Sidebar aria-label={navigationLabel} collapsible="offcanvas">
        <SidebarHeader>
          <div className="gdg-sidebar-title">{brand}</div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>{navigation}</SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className="gdg-shell-body">
        <header className="gdg-shell-header">
          <div className="gdg-mobile-only">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
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
                    if ((e.target as HTMLElement).closest("a")) setMobileNavOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.target as HTMLElement).closest("a"))
                      setMobileNavOpen(false);
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
        <SidebarInset id="gdg-main" tabIndex={-1} className="gdg-main">
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
