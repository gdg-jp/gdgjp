import { useEffect, useRef, useState } from "react";

interface MermaidBlockProps {
  code: string;
  id?: string;
}

/**
 * Client-side Mermaid diagram renderer.
 *
 * Lazily imports mermaid.js and renders the diagram into an inline SVG.
 * Falls back to a <pre> code block if rendering fails or during SSR.
 */
export default function MermaidBlock({ code, id }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "strict",
        });

        const mermaidId = id ?? `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: rendered } = await mermaid.render(mermaidId, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Mermaid render failed");
          setSvg(null);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error || !svg) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid SVG output is sanitized by mermaid.js with securityLevel=strict
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
