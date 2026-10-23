import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('./generate-tokens.mjs', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'design-token-test-'));
const source = join(workspace, 'tokens.json');
const output = join(workspace, 'generated/theme.css');
const run = (...args) => {
  const result = spawnSync(process.execPath, [generator, ...args], { encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
};
const expect = (status, ...args) => {
  const result = run(...args);
  assert.equal(result.status, status, result.stderr);
  return result;
};

try {
  copyFileSync(new URL('./tokens.json', import.meta.url), source);
  assert.match(expect(1, source, output, '--check').stderr, /TOKEN-DRIFT/);
  assert.equal(existsSync(output), false, 'Checking must not generate missing output');
  expect(0, source, output);
  const generated = readFileSync(output, 'utf8');
  assert.match(generated, /--color-action: #2448a5;/);
  assert.match(generated, /--space-control: 0.75rem;/);
  expect(0, source, output, '--check');
  const edited = generated.replace('#2448a5', '#000000');
  writeFileSync(output, edited);
  assert.match(expect(1, source, output, '--check').stderr, /TOKEN-DRIFT/);
  assert.equal(readFileSync(output, 'utf8'), edited, 'Checking must not hide drift');
  expect(0, source, output);
  expect(0, source, output, '--check');
  const tokens = JSON.parse(readFileSync(source, 'utf8'));
  tokens['space-control'] = '1rem';
  writeFileSync(source, JSON.stringify(tokens));
  expect(1, source, output, '--check');
  expect(0, source, output);
  expect(0, source, output, '--check');
  assert.match(readFileSync(output, 'utf8'), /--space-control: 1rem;/);
  const validSource = readFileSync(source, 'utf8');
  expect(1, source, source);
  assert.equal(readFileSync(source, 'utf8'), validSource);
  const alias = join(workspace, 'source-alias.css');
  symlinkSync(source, alias);
  expect(1, source, alias);
  assert.equal(readFileSync(source, 'utf8'), validSource);
  const lastGood = readFileSync(output, 'utf8');
  for (const invalid of [null, [], {}, { 'bad;name': '#fff' }, { color: '#fff;}' }, { space: 8 }]) {
    writeFileSync(source, JSON.stringify(invalid));
    expect(1, source, output);
    assert.equal(readFileSync(output, 'utf8'), lastGood, 'Invalid input must preserve output');
  }
  writeFileSync(source, '{');
  expect(1, source, output);
  assert.equal(readFileSync(output, 'utf8'), lastGood);
  expect(1, source, output, '--unknown');
  console.log('PASS: generation, drift rejection, correction, invalid input, and source protection');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
