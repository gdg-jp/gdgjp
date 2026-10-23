import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { parse } from 'parse5';
import * as z from 'zod/v4';
import { renderTokens } from './generate-tokens.mjs';

const text = z.string().trim().min(1);
export const slug = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const htmlSourceSchema = z.string().min(1).max(1_000_000).refine(source => source.trim().length > 0, 'HTML must not be blank');
const id = z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/);
const commonRule = {
  id: z.string().regex(/^[A-Z][A-Z0-9-]{0,99}$/),
  scope: z.array(id).min(1), description: text, fix: text,
};
export const ruleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...commonRule, kind: z.literal('manual') }),
  z.strictObject({
    ...commonRule, kind: z.literal('required-attribute'),
    // ponytail: tag selectors only; add an explicit detector for more complex policy.
    selector: z.string().regex(/^[a-z][a-z0-9-]*$/),
    attribute: z.string().regex(/^[a-z][a-z0-9-]*$/),
    allowEmpty: z.boolean(), values: z.array(text).min(1).optional(),
  }),
]);
export const decisionSchema = z.strictObject({
  status: z.enum(['accepted', 'rejected']), reviewer: text, reason: text,
  reviewedDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const catalogSchema = z.strictObject({
  version: z.literal(1),
  documents: z.array(z.strictObject({
    id, kind: z.enum(['component', 'pattern', 'scenario']), title: text,
    description: text, refs: z.array(id), skills: z.array(slug),
    details: z.record(z.string(), z.unknown()),
  })).min(1),
  rules: z.array(ruleSchema),
  adoptions: z.array(z.strictObject({
    proposalId: slug, proposalDigest: text, ruleId: text,
    decision: decisionSchema, appliedAt: text,
  })),
});
export const digest = value => createHash('sha256').update(value).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function localPath(root, path) {
  const absoluteRoot = realpathSync(root);
  const absolute = realpathSync(resolve(root, path));
  const rel = relative(absoluteRoot, absolute);
  assert(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel), 'Path must remain inside the harness');
  return absolute;
}

export function validateCatalog(value) {
  const catalog = catalogSchema.parse(value);
  const documents = new Map(catalog.documents.map(doc => [doc.id, doc]));
  assert.equal(documents.size, catalog.documents.length, 'Duplicate document ID');
  assert.equal(new Set(catalog.rules.map(rule => rule.id)).size, catalog.rules.length, 'Duplicate rule ID');
  assert.equal(new Set(catalog.adoptions.map(item => item.proposalId)).size, catalog.adoptions.length, 'Duplicate adoption ID');
  for (const doc of catalog.documents) {
    for (const ref of doc.refs) assert(documents.has(ref), `Unknown reference: ${ref}`);
  }
  for (const rule of catalog.rules) {
    for (const scope of rule.scope) assert(documents.has(scope), `Unknown rule scope: ${scope}`);
  }
  for (const adoption of catalog.adoptions) {
    assert.equal(adoption.decision.status, 'accepted', 'Adoption must have an accepted decision');
    // Historical receipts survive later reviewed retirement of the adopted rule.
  }
  return catalog;
}

export function loadHarness(root) {
  const read = path => readFileSync(localPath(root, path), 'utf8');
  const rawCatalog = read('design/catalog.json');
  const catalog = validateCatalog(JSON.parse(rawCatalog));
  const rawTokens = read('design/tokens.json');
  const tokens = JSON.parse(rawTokens);
  renderTokens(tokens); // Validate with the exact source-to-theme implementation.
  const skillNames = [...new Set(catalog.documents.flatMap(doc => doc.skills))].sort();
  const skills = skillNames.map(name => {
    const path = `.agents/skills/${name}/SKILL.md`;
    const content = read(path);
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    assert(frontmatter, `Missing Skill frontmatter: ${name}`);
    assert.equal(frontmatter.match(/^name: (.+)$/m)?.[1]?.trim(), name, `Skill name mismatch: ${name}`);
    const description = frontmatter.match(/^description: (.+)$/m)?.[1]?.trim();
    assert(description, `Missing Skill description: ${name}`);
    return { id: name, path, description, content };
  });
  const constitution = read('DESIGN.md');
  const contractRevision = digest(rawCatalog + rawTokens + constitution + skills.map(s => s.content).join('\n'));
  const resources = [
    { id: 'design.entry', kind: 'entry', title: 'Design entrypoint', description: 'Authority, workflow, commands, and limits.', body: constitution },
    { id: 'design.tokens', kind: 'tokens', title: 'Semantic tokens', description: 'Values consumed by the generated theme.', body: json(tokens) },
    ...catalog.documents.map(doc => ({ ...doc, body: json(doc) })),
    ...catalog.rules.map(rule => ({ id: rule.id, kind: 'rule', title: rule.id, description: rule.description, body: json(rule) })),
    ...skills.map(skill => ({ id: `skill.${skill.id}`, kind: 'skill', title: skill.id, description: skill.description, body: skill.content })),
  ].map(resource => ({ ...resource, uri: `harness://design/${resource.id}`, mimeType: ['entry', 'skill'].includes(resource.kind) ? 'text/markdown' : 'application/json' }));
  assert.equal(new Set(resources.map(r => r.id)).size, resources.length, 'Resource ID collision');
  return { root, catalog, tokens, skills, resources, contractRevision };
}

export const describeResource = ({ id, kind, title, description, uri, mimeType }) => ({ id, kind, title, description, uri, mimeType });

export function readResource(harness, uri) {
  const resource = harness.resources.find(resource => resource.uri === uri);
  assert(resource, `Unknown resource: ${uri}`);
  return { uri, mimeType: resource.mimeType, text: resource.body };
}

export function searchDesign(harness, query) {
  const needle = z.string().trim().min(1).max(200).parse(query).toLowerCase();
  const matches = harness.resources.filter(r => `${r.id} ${r.title} ${r.description}`.toLowerCase().includes(needle));
  return { contractRevision: harness.contractRevision, results: matches.slice(0, 20).map(describeResource), truncated: matches.length > 20 };
}

export function resolveContext(harness, scenarioId) {
  const docs = new Map(harness.catalog.documents.map(doc => [doc.id, doc]));
  assert.equal(docs.get(scenarioId)?.kind, 'scenario', `Unknown scenario: ${scenarioId}`);
  const selected = new Set(['design.entry', 'design.tokens']);
  const names = new Set();
  const visit = ref => {
    if (selected.has(ref)) return;
    const doc = docs.get(ref);
    assert(doc, `Unknown reference: ${ref}`);
    selected.add(ref);
    doc.refs.forEach(visit);
    doc.skills.forEach(name => { names.add(name); selected.add(`skill.${name}`); });
  };
  visit(scenarioId);
  for (const rule of harness.catalog.rules) {
    if (rule.scope.some(scope => selected.has(scope))) selected.add(rule.id);
  }
  return {
    contractRevision: harness.contractRevision, scenarioId,
    resources: harness.resources.filter(r => selected.has(r.id)).map(describeResource),
    skills: harness.skills.filter(s => names.has(s.id)).map(({ id, path }) => ({ id, path })),
  };
}

export function checkDesign(harness, source, scenarioId = 'scenario.profile-edit') {
  htmlSourceSchema.parse(source);
  const selected = new Set(resolveContext(harness, scenarioId).resources.map(r => r.id));
  const rules = harness.catalog.rules.filter(rule => selected.has(rule.id));
  const dom = parse(source);
  const elements = [];
  const pending = [dom];
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName) elements.push(node);
    pending.push(...(node.childNodes ?? []).toReversed());
  }
  const violations = [];
  const checks = rules.map(rule => {
    if (rule.kind === 'manual') return { rule: rule.id, status: 'not-evaluated', observation: 'Rendered evidence and contextual review are required.', nextAction: rule.fix };
    const nodes = elements.filter(node => node.tagName === rule.selector);
    for (const [index, node] of nodes.entries()) {
      const value = node.attrs.find(attr => attr.name === rule.attribute)?.value;
      if (value === undefined || (!rule.allowEmpty && !value.trim()) || (rule.values && !rule.values.includes(value))) {
        violations.push({ rule: rule.id, element: rule.selector, index, observation: `Missing or unsupported ${rule.attribute} attribute.`, nextAction: rule.fix });
      }
    }
    return {
      rule: rule.id,
      status: !nodes.length ? 'not-applicable' : violations.some(v => v.rule === rule.id) ? 'fail' : 'pass',
      observation: nodes.length ? `Inspected ${nodes.length} ${rule.selector} element(s).` : `No ${rule.selector} elements in this HTML.`,
    };
  });
  return {
    scenarioId, artifactRevision: digest(source), contractRevision: harness.contractRevision,
    mechanicalPassed: !violations.length, violations, checks,
    coverage: {
      automated: rules.filter(r => r.kind !== 'manual').map(r => r.id),
      notAutomated: rules.filter(r => r.kind === 'manual').map(r => ({ rule: r.id, reason: 'Requires rendered evidence and judgment' })),
      limits: 'Static HTML attributes only. No scripts, CSS, accessible-name computation, interactions, or visual/brand approval.',
    },
  };
}

export function catalogMarkdown(harness) {
  const lines = ['# Generated design catalog', '', `Contract revision: ${harness.contractRevision}`, '', 'Generated from the authority files; do not edit.', ''];
  for (const resource of harness.resources) {
    const fence = '`'.repeat(Math.max(2, ...[...resource.body.matchAll(/`+/g)].map(match => match[0].length)) + 1);
    lines.push(`## ${resource.id}`, '', `${resource.kind}: ${resource.description}`, '', `Resource: \`${resource.uri}\``, '', fence + (resource.mimeType === 'application/json' ? 'json' : 'markdown'), resource.body.trim(), fence, '');
  }
  return lines.join('\n');
}
