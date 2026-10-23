import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const template = fileURLToPath(new URL('.', import.meta.url));
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'harness-test-'));
  cpSync(template, root, { recursive: true, filter: path => !['node_modules', 'generated', 'runs', 'feedback', '.feedback.lock'].includes(basename(path)) });
  symlinkSync(join(template, 'node_modules'), join(root, 'node_modules'), 'dir');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const read = (root, path) => readFileSync(join(root, path), 'utf8');
const write = (root, path, value) => writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
function cli(root, code, ...args) {
  const result = spawnSync(process.execPath, ['cli.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, code, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return code === 2 ? result.stderr : JSON.parse(result.stdout);
}
async function connect(root) {
  const client = new Client({ name: 'harness-acceptance', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'mcp.mjs')], cwd: tmpdir(), stderr: 'pipe' });
  try { await client.connect(transport); return client; }
  catch (error) { await transport.close(); throw error; }
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, JSON.stringify(result));
  return result.structuredContent;
}

test('CLI checks actual HTML, resolves dependencies, and refuses broken authorities', t => {
  const root = workspace(t);
  const context = cli(root, 0, 'resolve', 'scenario.profile-edit');
  assert.deepEqual(context.skills.map(s => s.id), ['design-build', 'design-improve', 'design-review']);
  assert(context.resources.some(r => r.id === 'HTML-BUTTON-TYPE'));
  const bad = '<button>Save</button>';
  write(root, 'case.html', bad);
  assert.equal(cli(root, 1, 'check', 'case.html').violations[0].rule, 'HTML-BUTTON-TYPE');
  write(root, 'case.html', '<button type="submit">Save</button><script>"<button>not markup</button>"</script>');
  const corrected = cli(root, 0, 'check', 'case.html');
  assert(corrected.mechanicalPassed);
  assert.equal(corrected.checks.find(c => c.rule === 'TASK-FIT').status, 'not-evaluated');
  write(root, 'case.html', '<button type="button">Cancel</button>');
  assert.equal(cli(root, 0, 'check', 'case.html').violations.length, 0);
  write(root, 'case.html', '<title><button>Text</button></title><textarea><button>Text</button></textarea><template><button>Inert</button></template>');
  assert.equal(cli(root, 0, 'check', 'case.html').violations.length, 0, 'Raw text and inert template contents are not document buttons');
  write(root, 'case.html', read(root, 'case.html') + '<button>Actual control</button>');
  assert.equal(cli(root, 1, 'check', 'case.html').violations.length, 1);
  write(root, 'case.html', '<button type="  ">Save</button>');
  cli(root, 1, 'check', 'case.html');
  cli(root, 2, 'check', 'case.jsx');
  cli(root, 2, 'check', 'case.html', 'scenario.unknown');
  cli(root, 2, 'resolve', '../private');
  const tokens = read(root, 'design/tokens.json');
  write(root, 'design/tokens.json', { 'color-action': 'not-a-supported-token' });
  assert.match(cli(root, 2, 'catalog'), /Unsupported token value/);
  write(root, 'design/tokens.json', tokens);
  const original = read(root, 'design/catalog.json');
  const catalog = JSON.parse(original);
  catalog.documents[0].refs.push('component.unknown');
  write(root, 'design/catalog.json', catalog);
  assert.match(cli(root, 2, 'catalog'), /Unknown reference/);
  write(root, 'design/catalog.json', original);
  const skill = '.agents/skills/design-build/SKILL.md';
  write(root, skill, read(root, skill).replace('name: design-build', 'name: unrelated'));
  assert.match(cli(root, 2, 'resolve', 'scenario.profile-edit'), /Skill name mismatch/);
});

test('drift checks never repair files, and generated docs include changed source data', t => {
  const root = workspace(t);
  cli(root, 2, 'generate', '--check');
  cli(root, 0, 'generate');
  cli(root, 0, 'generate', '--check');
  const authority = read(root, 'DESIGN.md');
  rmSync(join(root, 'generated/theme.css'));
  symlinkSync(join(root, 'DESIGN.md'), join(root, 'generated/theme.css'));
  assert.match(cli(root, 2, 'generate'), /symbolic links/);
  assert.equal(read(root, 'DESIGN.md'), authority, 'Generating must never overwrite authority through a symlink');
  rmSync(join(root, 'generated/theme.css'));
  cli(root, 0, 'generate');
  const catalog = JSON.parse(read(root, 'design/catalog.json'));
  catalog.documents[0].description = 'Updated button guidance for the next task.';
  write(root, 'design/catalog.json', catalog);
  const oldView = read(root, 'generated/catalog.md');
  assert.match(cli(root, 2, 'generate', '--check'), /CATALOG-DRIFT/);
  assert.equal(read(root, 'generated/catalog.md'), oldView);
  cli(root, 0, 'generate');
  assert(read(root, 'generated/catalog.md').includes(catalog.documents[0].description));
  write(root, 'generated/theme.css', 'manually changed');
  assert.match(cli(root, 2, 'generate', '--check'), /TOKEN-DRIFT/);
  assert.equal(read(root, 'generated/theme.css'), 'manually changed');
  cli(root, 0, 'generate');
  cli(root, 0, 'generate', '--check');
  catalog.rules[0].kind = 'unknown-detector';
  write(root, 'design/catalog.json', catalog);
  cli(root, 2, 'catalog');
});

test('real stdio MCP agrees with CLI and rejects invalid/publication-boundary requests', { timeout: 30_000 }, async t => {
  const root = workspace(t);
  const client = await connect(root);
  try {
    const listed = await client.listResources();
    assert(listed.resources.some(r => r.uri === 'harness://design/design.entry'));
    for (const resource of listed.resources) {
      const result = await client.readResource({ uri: resource.uri });
      assert(result.contents[0].text.length > 0);
    }
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ['check_design', 'resolve_design_context', 'search_design']);
    const search = await call(client, 'search_design', { query: 'button' });
    assert(search.results.some(r => r.id === 'component.button'));
    assert.deepEqual(await call(client, 'resolve_design_context', { scenarioId: 'scenario.profile-edit' }), cli(root, 0, 'resolve', 'scenario.profile-edit'));
    const source = '<button>Save</button>';
    write(root, 'bad.html', source);
    assert.deepEqual(await call(client, 'check_design', { source }), cli(root, 1, 'check', 'bad.html'));
    const unknown = await client.callTool({ name: 'resolve_design_context', arguments: { scenarioId: 'scenario.unknown' } });
    assert.equal(unknown.isError, true);
    const invalid = await client.callTool({ name: 'check_design', arguments: { source: 12 } });
    assert.equal(invalid.isError, true);
    await assert.rejects(client.readResource({ uri: 'harness://design/../../DESIGN.md' }));
    await assert.rejects(client.readResource({ uri: 'harness://design/feedback/image-alt' }));
  } finally { await client.close(); }
});

test('reviewed learning reaches a new MCP run; pending/rejected/stale proposals never change authority', { timeout: 45_000 }, async t => {
  const root = workspace(t);
  mkdirSync(join(root, 'runs'));
  const original = read(root, 'design/catalog.json');
  const source = read(root, 'examples/image.html');
  write(root, 'runs/image-before.json', cli(root, 0, 'check', 'examples/image.html'));
  cli(root, 0, 'feedback', 'propose', 'examples/image-alt-proposal.json');
  cli(root, 2, 'feedback', 'apply', 'image-alt');
  assert.equal(read(root, 'design/catalog.json'), original);
  cli(root, 0, 'feedback', 'decide', 'image-alt', 'rejected', 'Test fixture', 'A rejected candidate must not change policy.');
  cli(root, 2, 'feedback', 'apply', 'image-alt');
  assert.equal(read(root, 'design/catalog.json'), original);
  const draft = JSON.parse(read(root, 'examples/image-alt-proposal.json'));
  draft.id = 'image-alt-reviewed';
  write(root, 'candidate.json', draft);
  cli(root, 0, 'feedback', 'propose', 'candidate.json');
  cli(root, 0, 'feedback', 'decide', draft.id, 'accepted', 'Test fixture', 'Exercise an explicitly simulated accepted decision.');
  const reviewedProposal = read(root, `feedback/${draft.id}.json`);
  const alteredProposal = JSON.parse(reviewedProposal);
  alteredProposal.rule.attribute = 'data-unreviewed';
  write(root, `feedback/${draft.id}.json`, alteredProposal);
  assert.match(cli(root, 2, 'feedback', 'apply', draft.id), /Reviewed proposal changed/);
  assert.equal(read(root, 'design/catalog.json'), original);
  write(root, `feedback/${draft.id}.json`, reviewedProposal);
  write(root, 'examples/image.html', source + '\n');
  assert.match(cli(root, 2, 'feedback', 'apply', draft.id), /Evidence changed/);
  write(root, 'examples/image.html', source);
  const tokenSource = read(root, 'design/tokens.json');
  write(root, 'design/tokens.json', tokenSource + '\n');
  assert.match(cli(root, 2, 'feedback', 'apply', draft.id), /Authority changed/);
  assert.equal(read(root, 'design/catalog.json'), original);
  write(root, 'design/tokens.json', tokenSource);
  const previous = await connect(root);
  try {
    const before = await call(previous, 'check_design', { source });
    assert(!before.coverage.automated.includes('HTML-IMAGE-ALT'));
    cli(root, 0, 'generate');
    const adoption = cli(root, 0, 'feedback', 'apply', draft.id);
    assert.equal(adoption.status, 'applied');
    assert.equal(cli(root, 0, 'feedback', 'apply', draft.id).status, 'already-applied');
    cli(root, 2, 'generate', '--check');
    cli(root, 0, 'generate');
    cli(root, 0, 'generate', '--check');
    assert.equal((await call(previous, 'check_design', { source })).contractRevision, before.contractRevision, 'Existing process retains its documented snapshot');
    const next = await connect(root);
    try {
      const context = await call(next, 'resolve_design_context', { scenarioId: 'scenario.profile-edit' });
      assert(context.resources.some(r => r.id === 'HTML-IMAGE-ALT'));
      assert((await next.readResource({ uri: 'harness://design/HTML-IMAGE-ALT' })).contents[0].text.includes(draft.rule.description));
      const after = await call(next, 'check_design', { source });
      assert.notEqual(after.contractRevision, before.contractRevision);
      assert.equal(after.artifactRevision, before.artifactRevision);
      assert.equal(after.violations[0].rule, 'HTML-IMAGE-ALT');
      assert.deepEqual(after, cli(root, 1, 'check', 'examples/image.html'));
      write(root, 'examples/image.html', source.replace('<img ', '<img alt="Profile avatar" '));
      assert.equal(cli(root, 0, 'check', 'examples/image.html').mechanicalPassed, true);
      assert((await call(next, 'check_design', { source: '<img src="avatar.svg" alt="">' })).mechanicalPassed);
      assert(!(await call(next, 'check_design', { source: '<img src="another.svg">' })).mechanicalPassed);
      assert(!(await next.listResources()).resources.some(r => r.uri.includes('feedback/')));
    } finally { await next.close(); }
  } finally { await previous.close(); }
  const catalog = JSON.parse(read(root, 'design/catalog.json'));
  assert.equal(catalog.adoptions.length, 1);
  catalog.documents.push({ id: 'scenario.other', kind: 'scenario', title: 'Other task', description: 'No profile rules apply here.', refs: [], skills: [] , details: {} });
  write(root, 'design/catalog.json', catalog);
  write(root, 'other.html', '<img src="unrelated.svg">');
  assert.equal(cli(root, 0, 'check', 'other.html', 'scenario.other').coverage.automated.length, 0, 'A scoped lesson must not become global policy');
});
