import prototype from "prototype:entry";
import { createRoot } from "react-dom/client";
import { FrameHost, captureIssues, readFrameConfig } from "./frame";
import { Shell } from "./shell";
import "./spec.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const config = readFrameConfig();
if (config) captureIssues(config.target);
createRoot(root).render(
  config ? <FrameHost prototype={prototype} config={config} /> : <Shell prototype={prototype} />,
);
