import type { Preview } from "@storybook/react-vite";
import { type ReactNode, useEffect } from "react";
import { ThemeProvider, useTheme } from "../src";
import "../src/styles/tokens.css";
import "../src/styles/components.css";
import "../src/styles/fonts.css";
import "../stories/preview.css";
function SyncTheme({ theme, children }: { theme: string; children: ReactNode }) {
  const { setTheme } = useTheme();
  useEffect(() => setTheme(theme), [theme, setTheme]);
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
          <div className="gdg-preview">
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
