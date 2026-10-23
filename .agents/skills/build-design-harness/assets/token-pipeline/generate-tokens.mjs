import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function renderTokens(tokens) {
  assert(tokens && typeof tokens === 'object' && !Array.isArray(tokens),
    'Tokens must be a name/value object');
  const entries = Object.entries(tokens).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  assert(entries.length, 'Tokens must not be empty');
  for (const [name, value] of entries) {
    assert(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name), `Invalid token name: ${name}`);
    // ponytail: hex and px/rem only; extend the schema/generator for other token types.
    assert(typeof value === 'string' && /^(?:#[\da-fA-F]{3}|#[\da-fA-F]{6}|(?:0|[1-9]\d*)(?:\.\d+)?(?:px|rem))$/.test(value),
      `Unsupported token value for ${name}`);
  }
  return '/* Generated from tokens; do not edit. */\n:root {\n'
    + entries.map(([name, value]) => `  --${name}: ${value};`).join('\n') + '\n}\n';
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, output, mode, ...extra] = process.argv.slice(2);
    assert(source && output && !extra.length && (!mode || mode === '--check'),
      'Usage: node generate-tokens.mjs source.json output.css [--check]');
    const sourcePath = realpathSync(source);
    const outputPath = existsSync(output) ? realpathSync(output) : resolve(output);
    assert.notEqual(sourcePath, outputPath, 'Input and output must be different files');
    const css = renderTokens(JSON.parse(readFileSync(sourcePath, 'utf8')));
    if (mode === '--check') {
      assert(existsSync(outputPath), 'TOKEN-DRIFT: generated CSS is missing');
      assert.equal(readFileSync(outputPath, 'utf8'), css,
        'TOKEN-DRIFT: generated CSS differs; regenerate from the authoritative tokens');
      console.log('TOKEN-DRIFT: pass');
    } else {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, css);
      console.log(`Generated ${output}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
