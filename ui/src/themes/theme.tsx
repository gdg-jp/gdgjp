import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { type ComponentProps, useEffect, useState } from "react";
import { TooltipProvider } from "../components/Tooltip";

export { useTheme };
export type ThemeProviderProps = Pick<
  ComponentProps<typeof NextThemeProvider>,
  "children" | "nonce" | "forcedTheme" | "storageKey" | "defaultTheme"
>;

export function ThemeProvider({
  children,
  storageKey = "gdg-apps-theme",
  defaultTheme = "system",
  ...props
}: ThemeProviderProps) {
  useEffect(() => {
    const key = () => {
      document.documentElement.dataset.gdgInput = "keyboard";
    };
    const pointer = () => {
      document.documentElement.dataset.gdgInput = "pointer";
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  return (
    <NextThemeProvider
      {...props}
      attribute="class"
      storageKey={storageKey}
      defaultTheme={defaultTheme}
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={400} skipDelayDuration={300}>
        {children}
      </TooltipProvider>
    </NextThemeProvider>
  );
}

export function ThemeToggle({
  "aria-label": label = "配色",
  className,
}: { "aria-label"?: string; className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <select
      aria-label={label}
      className={`gdg-input ${className ?? ""}`}
      value={mounted ? theme : "system"}
      disabled={!mounted}
      onChange={(e) => setTheme(e.target.value)}
    >
      <option value="system">システム</option>
      <option value="light">ライト</option>
      <option value="dark">ダーク</option>
    </select>
  );
}
