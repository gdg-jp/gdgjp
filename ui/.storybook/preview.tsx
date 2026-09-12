import type { Preview } from "@storybook/react-vite";
import { type ReactNode, useEffect, useRef } from "react";
import { ThemeProvider, useTheme } from "../src/index.ts";
import "../src/styles/tokens.css";
import "../src/styles/components.css";
import "../src/styles/fonts.css";
import "../src/examples/preview.css";
function SyncTheme({ theme, children }: { theme: string; children: ReactNode }) {
  const { setTheme } = useTheme();
  const syncedTheme = useRef<string>();
  useEffect(() => {
    if (syncedTheme.current === theme) return;
    syncedTheme.current = theme;
    setTheme(theme);
  }, [theme, setTheme]);
  return children;
}
const preview: Preview = {
  globalTypes: {
    theme: { description: "Theme", toolbar: { icon: "circlehollow", items: ["light", "dark"] } },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, context) => (
      <ThemeProvider>
        <SyncTheme theme={context.globals.theme}>
          <div className="gdg-story-preview">
            <Story />
          </div>
        </SyncTheme>
      </ThemeProvider>
    ),
  ],
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
};
export default preview;
