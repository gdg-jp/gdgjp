import type { ReactNode } from "react";
import { Link } from "react-router";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link
            to="/"
            className="font-semibold tracking-tight text-slate-900"
            aria-label="GDG Japan ホーム"
          >
            GDG Japan
          </Link>
          <nav
            aria-label="主要ナビゲーション"
            className="flex items-center gap-4 text-sm text-slate-600"
          >
            <Link to="/privacy" className="hover:text-blue-700 focus-visible:text-blue-700">
              プライバシー
            </Link>
            <Link to="/terms" className="hover:text-blue-700 focus-visible:text-blue-700">
              利用規約
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} GDG Japan</p>
          <nav aria-label="フッターナビゲーション" className="flex gap-4">
            <Link to="/" className="hover:text-blue-700 focus-visible:text-blue-700">
              ホーム
            </Link>
            <Link to="/privacy" className="hover:text-blue-700 focus-visible:text-blue-700">
              プライバシーポリシー
            </Link>
            <Link to="/terms" className="hover:text-blue-700 focus-visible:text-blue-700">
              利用規約
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
