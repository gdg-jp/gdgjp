import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TooltipProvider } from "../components/Tooltip";
export { useTheme };
export function ThemeProvider({
  children,
  storageKey = "gdg-apps-theme",
  defaultTheme = "system",
  ...props
}) {
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
  return _jsx(NextThemeProvider, {
    ...props,
    attribute: "class",
    storageKey: storageKey,
    defaultTheme: defaultTheme,
    enableSystem: true,
    disableTransitionOnChange: true,
    children: _jsx(TooltipProvider, {
      delayDuration: 400,
      skipDelayDuration: 300,
      children: children,
    }),
  });
}
export function ThemeToggle({ "aria-label": label = "配色", className }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return _jsxs("select", {
    "aria-label": label,
    className: `gdg-input ${className ?? ""}`,
    value: mounted ? theme : "system",
    disabled: !mounted,
    onChange: (e) => setTheme(e.target.value),
    children: [
      _jsx("option", { value: "system", children: "\u30B7\u30B9\u30C6\u30E0" }),
      _jsx("option", { value: "light", children: "\u30E9\u30A4\u30C8" }),
      _jsx("option", { value: "dark", children: "\u30C0\u30FC\u30AF" }),
    ],
  });
}
