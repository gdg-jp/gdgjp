import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { decisionSchema, digest, json, loadHarness, localPath, ruleSchema, slug, validateCatalog } from './core.mjs';

const text = z.string().trim().min(1);
const draftSchema = z.strictObject({
  id: slug, observation: text, evidence: z.array(text).min(1),
  target: z.literal('design/catalog.json'), rule: ruleSchema,
});
const proposalSchema = draftSchema.extend({
  baseRevision: text,
  evidenceDigests: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  decision: z.union([z.strictObject({ status: z.literal('proposed') }), decisionSchema]),
});
const candidateDigest = ({ decision, ...candidate }) => digest(json(candidate));
const evidenceDigests = (root, paths) => Object.fromEntries(paths.map(path => [path, digest(readFileSync(localPath(root, path)))]));

export function atomicWrite(root, path, content) {
  const destination = resolve(root, path);
  localPath(root, dirname(destination));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx' });
    renameSync(temporary, destination);
  } finally { rmSync(temporary, { force: true }); }
}

export function updateFeedback(root, action, args) {
  // ponytail: serialize local maintenance; use repository review for distributed writers.
  const lock = resolve(root, '.feedback.lock');
  const fd = openSync(lock, 'wx');
  try {
    const harness = loadHarness(root);
    const feedbackDirectory = resolve(root, 'feedback');
    if (!existsSync(feedbackDirectory)) mkdirSync(feedbackDirectory);
    localPath(root, 'feedback');
    if (action === 'propose') {
      assert.equal(args.length, 1, 'Usage: feedback propose DRAFT.json');
      const draft = draftSchema.parse(JSON.parse(readFileSync(localPath(root, args[0]), 'utf8')));
      const evidence = evidenceDigests(root, draft.evidence);
      assert(!harness.catalog.rules.some(rule => rule.id === draft.rule.id), 'Rule already exists; review its authority instead');
      validateCatalog({ ...harness.catalog, rules: [...harness.catalog.rules, draft.rule] });
      const path = `feedback/${draft.id}.json`;
      assert(!existsSync(resolve(root, path)), 'Proposal already exists');
      const proposal = { ...draft, baseRevision: harness.contractRevision, evidenceDigests: evidence, decision: { status: 'proposed' } };
      atomicWrite(root, path, json(proposal));
      return proposal;
    }
    assert(['decide', 'apply'].includes(action), 'Unknown feedback action');
    const proposalId = slug.parse(args[0]);
    const path = `feedback/${proposalId}.json`;
    const proposal = proposalSchema.parse(JSON.parse(readFileSync(localPath(root, path), 'utf8')));
    assert.equal(proposal.id, proposalId, 'Proposal ID mismatch');
    const receipt = harness.catalog.adoptions.find(item => item.proposalId === proposalId);
    if (action === 'decide') {
      assert.equal(args.length, 4, 'Usage: feedback decide ID accepted|rejected REVIEWER REASON');
      assert(!receipt, 'Applied proposals cannot be re-decided');
      assert.equal(proposal.decision.status, 'proposed', 'Decision already recorded; create a new proposal to reconsider');
      assert.deepEqual(evidenceDigests(root, proposal.evidence), proposal.evidenceDigests, 'Evidence changed; create a fresh proposal');
      proposal.decision = decisionSchema.parse({ status: args[1], reviewer: args[2], reason: args[3], reviewedDigest: candidateDigest(proposal) });
      atomicWrite(root, path, json(proposal));
      return proposal;
    }
    assert.equal(args.length, 1, 'Usage: feedback apply ID');
    assert.equal(proposal.decision.status, 'accepted', 'Only accepted proposals can be applied');
    assert.equal(proposal.decision.reviewedDigest, candidateDigest(proposal), 'Reviewed proposal changed; create a fresh proposal');
    const proposalDigest = digest(json(proposal));
    if (receipt) {
      assert.equal(receipt.proposalDigest, proposalDigest, 'Applied proposal has changed');
      return { status: 'already-applied', receipt };
    }
    assert.equal(proposal.baseRevision, harness.contractRevision, 'Authority changed; review and create a fresh proposal');
    assert.deepEqual(evidenceDigests(root, proposal.evidence), proposal.evidenceDigests, 'Evidence changed; create a fresh proposal');
    const adoption = { proposalId, proposalDigest, ruleId: proposal.rule.id, decision: proposal.decision, appliedAt: new Date().toISOString() };
    const updated = validateCatalog({
      ...harness.catalog,
      rules: [...harness.catalog.rules, proposal.rule],
      adoptions: [...harness.catalog.adoptions, adoption],
    });
    // Rule and receipt share one atomic write; a failed write cannot record a false adoption.
    atomicWrite(root, 'design/catalog.json', json(updated));
    return { status: 'applied', receipt: adoption, nextAction: 'Regenerate, check drift, restart MCP, and verify a fresh task.' };
  } finally { closeSync(fd); rmSync(lock); }
}
