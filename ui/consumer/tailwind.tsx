import { Button, ThemeProvider } from "@gdgjp/ui";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(
  <ThemeProvider>
    <main className="bg-background text-foreground p-8">
      <h1>Tailwind CSS contract</h1>
      <Button className="rounded-xl px-8">utility override</Button>
      <div data-testid="accent" className="bg-gdg-yellow text-black">
        GDG Yellow
      </div>
    </main>
  </ThemeProvider>,
);
