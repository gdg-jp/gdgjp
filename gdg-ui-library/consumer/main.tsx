import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "@gdgjp/gdg-ui-library/tokens.css";
import "@gdgjp/gdg-ui-library/components.css";
import "@gdgjp/gdg-ui-library/fonts.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing consumer root");
hydrateRoot(root, <App />);
