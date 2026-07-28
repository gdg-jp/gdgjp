import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => undefined,
});
export const themeInitScript = `try { document.documentElement.classList.toggle('dark', localStorage.getItem('sns-theme') === 'dark'); } catch {}`;
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("sns-theme", theme);
  }, [theme]);
  return (
    <ThemeContext.Provider
      value={{ theme, toggle: () => setTheme((value) => (value === "light" ? "dark" : "light")) }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function useTheme() {
  return useContext(ThemeContext);
}
