#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { checkDesign, htmlSourceSchema, loadHarness, readResource, resolveContext, searchDesign } from './core.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
// A process serves one immutable snapshot. Restart after accepted authority changes.
const harness = loadHarness(root);
const server = new McpServer({ name: 'design-harness-starter', version: '0.1.0' }, {
  instructions: 'Read harness://design/design.entry. Resolve a scenario before implementation. Check generated HTML; mechanical success leaves contextual review open. Restart after authority changes.',
});
for (const resource of harness.resources) {
  server.registerResource(resource.id, resource.uri, {
    title: resource.title, description: resource.description, mimeType: resource.mimeType,
  }, async () => ({ contents: [readResource(harness, resource.uri)] }));
}
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
function tool(name, description, inputSchema, run) {
  server.registerTool(name, { description, inputSchema, annotations }, async input => {
    try {
      const result = run(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}
tool('search_design', 'Search IDs, titles, and descriptions. Returns up to 20 resource descriptors and an explicit truncated flag.',
  z.strictObject({ query: z.string().trim().min(1).max(200) }), ({ query }) => searchDesign(harness, query));
tool('resolve_design_context', 'Resolve a scenario ID, such as scenario.profile-edit, to its dependencies and Agent Skills. Unknown IDs return an error; no partial contract is returned.',
  z.strictObject({ scenarioId: z.string().min(1) }), ({ scenarioId }) => resolveContext(harness, scenarioId));
tool('check_design', 'Check a nonempty static HTML source string, not a path or JSX. Returns rule findings and coverage, not visual or brand approval. Uses the CLI checker.',
  z.strictObject({ source: htmlSourceSchema, scenarioId: z.string().min(1).optional() }), ({ source, scenarioId }) => checkDesign(harness, source, scenarioId));
await server.connect(new StdioServerTransport());
