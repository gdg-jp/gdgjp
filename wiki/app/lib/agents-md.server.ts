import draft from "../../../docs/plans/03a-agents-md.md?raw";

const match = /````markdown\n([\s\S]*?)\n````/.exec(draft);

if (!match) throw new Error("Stage 3 AGENTS.md draft is missing its Markdown fence");

/** Canonical clone-root instructions, kept verbatim with the approved plan. */
export const AGENTS_MD = `${match[1]}\n`;
