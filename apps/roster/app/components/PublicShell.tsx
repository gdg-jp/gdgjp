import type { ReactNode } from "react";
import { RosterBrand } from "./RosterBrand";

export function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="public-page">
      <header className="public-header">
        <div className="brand-link">
          <RosterBrand size={36} />
        </div>
      </header>
      <main className={wide ? "public-content public-content-wide" : "public-content"}>
        {children}
      </main>
    </div>
  );
}
