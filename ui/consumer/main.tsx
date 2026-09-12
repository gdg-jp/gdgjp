import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "@gdgjp/ui/tokens.css";
import "@gdgjp/ui/components.css";
import "@gdgjp/ui/fonts.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing consumer root");
hydrateRoot(root, <App />);
