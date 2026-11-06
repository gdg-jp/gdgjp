// Guides, Skill instructions and output schemas, bundled as text for runner job bundles.
const guideFiles = import.meta.glob<string>("../../../../../skills/pr-playbook/guides/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});
const exampleFiles = import.meta.glob<string>(
  "../../../../../skills/pr-playbook/examples/**/*.{json,md}",
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
  "../../../../../skills/pr-*/references/example-output.json",
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
const templateFiles = import.meta.glob<string>(
  "../../../../../skills/pr-playbook/templates/**/*.{html,json,md}",
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

/** "pr-playbook/guides/x.md" → text */
export const guides = strip(guideFiles);
export const examples = strip(exampleFiles);
export const templates = strip(templateFiles);
/** "pr-x-post" → SKILL.md */
export const skills = Object.fromEntries(
  Object.entries(strip(skillFiles)).map(([path, text]) => [path.split("/")[0] as string, text]),
);
/** "pr-x-post" → output schema */
export const outputSchemas: Record<string, unknown> = Object.fromEntries(
  Object.entries(strip(schemaFiles)).map(([path, text]) => [
    path.split("/")[0] as string,
    JSON.parse(text),
  ]),
);

/** "pr-x-post" → example output (raw JSON text) */
export const exampleOutputs: Record<string, string> = Object.fromEntries(
  Object.entries(strip(exampleOutputFiles)).map(([path, text]) => [
    path.split("/")[0] as string,
    text,
  ]),
);
/** "pr-playbook/scripts/checks/x.mjs" → source; the runner bundle ships them so the agent can self-check. */
export const checkScripts = Object.fromEntries(
  Object.entries(strip(checkScriptFiles)).filter(([path]) => !path.endsWith(".test.mjs")),
);

/** Files a Skill asks for with `<!-- reads: a, b -->`, as playbook-relative paths. */
export function skillReads(skill: string): string[] {
  const text = skills[skill] ?? "";
  return [...text.matchAll(/<!--\s*reads:\s*([^>]+?)\s*-->/g)].flatMap((m) =>
    (m[1] ?? "").split(",").map((p) => p.trim()),
  );
}

/** Playbook file by playbook-relative path ("guides/x.md", "examples/…"). */
export function playbookFile(path: string): string | undefined {
  return (
    guides[`pr-playbook/${path}`] ??
    examples[`pr-playbook/${path}`] ??
    templates[`pr-playbook/${path}`]
  );
}
