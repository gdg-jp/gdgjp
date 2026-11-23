const guideFiles = import.meta.glob<string>("../../../../../skills/pr-playbook/guides/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});
const exampleFiles = import.meta.glob<string>(
  "../../../../../skills/pr-playbook/examples/**/*.{json,md,html}",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const skillFiles = import.meta.glob<string>("../../../../../skills/pr-*/SKILL.md", {
  eager: true,
  query: "?raw",
  import: "default",
});
const schemaFiles = import.meta.glob<string>(
  "../../../../../skills/pr-*/references/output.schema.json",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const exampleOutputFiles = import.meta.glob<string>(
  "../../../../../skills/pr-*/references/example-*output.json",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const checkScriptFiles = import.meta.glob<string>(
  "../../../../../skills/pr-playbook/scripts/checks/*.mjs",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const renderScriptFiles = import.meta.glob<string>(
  ["../../../../../skills/pr-playbook/scripts/render/*.mjs", "!**/*.test.mjs"],
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const rootDocFiles = import.meta.glob<string>(
  [
    "../../../../../skills/pr-playbook/decisions.md",
    "../../../../../skills/pr-playbook/proposals/README.md",
  ],
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const browserScriptFiles = import.meta.glob<string>(
  [
    "../../../../../skills/pr-playbook/scripts/render/checks-script.js",
    "../../../../../skills/gdg-design/assets/gdg.svg",
  ],
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const stickerFiles = import.meta.glob<string>(
  "../../../../../skills/gdg-design/assets/stickers/*.svg",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const templateFiles = import.meta.glob<string>(
  "../../../../../skills/pr-playbook/templates/**/*.{html,json,md,css}",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);

const PREFIX = "../../../../../skills/";
const strip = (files: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, text]) => [path.slice(PREFIX.length), text]),
  );

export const guides = strip(guideFiles);
export const examples = strip(exampleFiles);
export const templates = strip(templateFiles);
export const skills = Object.fromEntries(
  Object.entries(strip(skillFiles)).map(([path, text]) => [path.split("/")[0] as string, text]),
);
export const outputSchemas: Record<string, unknown> = Object.fromEntries(
  Object.entries(strip(schemaFiles)).map(([path, text]) => [
    path.split("/")[0] as string,
    JSON.parse(text),
  ]),
);

export const exampleOutputs: Record<string, string> = Object.fromEntries(
  Object.entries(strip(exampleOutputFiles))
    .filter(([path]) => path.endsWith("/example-output.json"))
    .map(([path, text]) => [path.split("/")[0] as string, text]),
);
export const exampleOutputFilesByPath: Record<string, string> = strip(exampleOutputFiles);
export const checkScripts = Object.fromEntries(
  Object.entries({ ...strip(checkScriptFiles), ...strip(renderScriptFiles) }).filter(
    ([path]) => !path.endsWith(".test.mjs"),
  ),
);

const SECTIONS = "pr-playbook/templates/connpass-page/sections/";
export const connpassSectionTemplates: Record<string, string> = Object.fromEntries(
  Object.entries(templates)
    .filter(([path]) => path.startsWith(SECTIONS) && path.endsWith(".html"))
    .map(([path, text]) => [path.slice(SECTIONS.length, -".html".length), text]),
);

export function skillReads(skill: string): string[] {
  const text = skills[skill] ?? "";
  return [...text.matchAll(/<!--\s*reads:\s*([^>]+?)\s*-->/g)].flatMap((m) =>
    (m[1] ?? "").split(",").map((p) => p.trim()),
  );
}

export function playbookFile(path: string): string | undefined {
  return (
    guides[`pr-playbook/${path}`] ??
    examples[`pr-playbook/${path}`] ??
    templates[`pr-playbook/${path}`] ??
    strip(rootDocFiles)[`pr-playbook/${path}`]
  );
}

const IMAGES = "pr-playbook/templates/images/";
export const imageTemplates = {
  html: Object.fromEntries(
    Object.entries(templates)
      .filter(([p]) => p.startsWith(IMAGES) && p.endsWith("/template.html"))
      .map(([p, text]) => [p.slice(IMAGES.length, -"/template.html".length), text]),
  ),
  schemas: Object.fromEntries(
    Object.entries(templates)
      .filter(([p]) => p.startsWith(IMAGES) && p.endsWith("/slots.schema.json"))
      .map(([p, text]) => [p.slice(IMAGES.length, -"/slots.schema.json".length), JSON.parse(text)]),
  ) as Record<string, { size: { width: number; height: number }; slots: Record<string, unknown> }>,
  baseCss: templates[`${IMAGES}base.css`] ?? "",
  checksScript: strip(browserScriptFiles)["pr-playbook/scripts/render/checks-script.js"] ?? "",
  logoSvg: strip(browserScriptFiles)["gdg-design/assets/gdg.svg"] ?? "",
};

const STICKERS = "gdg-design/assets/stickers/";
export const designAssets = {
  stickers: Object.fromEntries(
    Object.entries(strip(stickerFiles)).map(([p, text]) => [p.slice(STICKERS.length), text]),
  ) as Record<string, string>,
  examples: Object.fromEntries(
    Object.entries(examples).filter(([p]) => p.startsWith("pr-playbook/examples/design/")),
  ) as Record<string, string>,
};
