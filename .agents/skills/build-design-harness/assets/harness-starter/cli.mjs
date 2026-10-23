import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalogMarkdown, checkDesign, describeResource, json, loadHarness, localPath, resolveContext, searchDesign } from './core.mjs';
import { updateFeedback } from './feedback.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const [command, ...args] = process.argv.slice(2);
try {
  const harness = loadHarness(root);
  let result;
  switch (command) {
    case 'catalog':
      assert.equal(args.length, 0, 'Usage: catalog');
      result = harness.resources.map(describeResource);
      break;
    case 'resolve':
      assert.equal(args.length, 1, 'Usage: resolve SCENARIO_ID');
      result = resolveContext(harness, args[0]);
      break;
    case 'search':
      assert.equal(args.length, 1, 'Usage: search QUERY');
      result = searchDesign(harness, args[0]);
      break;
    case 'check':
      assert(args.length === 1 || args.length === 2, 'Usage: check FILE.html [SCENARIO_ID]');
      assert(args[0].endsWith('.html'), 'Only .html is supported; other source types require their own checker');
      result = checkDesign(harness, readFileSync(localPath(root, args[0]), 'utf8'), args[1]);
      process.exitCode = result.mechanicalPassed ? 0 : 1;
      break;
    case 'generate': {
      assert(args.length === 0 || (args.length === 1 && args[0] === '--check'), 'Usage: generate [--check]');
      const checking = args.length > 0;
      const output = resolve(root, 'generated');
      if (!checking && !existsSync(output)) mkdirSync(output);
      for (const path of [output, resolve(output, 'theme.css'), resolve(output, 'catalog.md')]) {
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (stat) {
          assert(!stat.isSymbolicLink(), 'Generated paths must not be symbolic links');
          localPath(root, path);
        }
      }
      const generator = spawnSync(process.execPath, [localPath(root, 'generate-tokens.mjs'), 'design/tokens.json', 'generated/theme.css', ...args], { cwd: root, encoding: 'utf8' });
      assert.ifError(generator.error);
      assert.equal(generator.status, 0, generator.stderr);
      const path = resolve(output, 'catalog.md');
      const content = catalogMarkdown(harness);
      if (checking) {
        assert.equal(readFileSync(localPath(root, path), 'utf8'), content, 'CATALOG-DRIFT: regenerate from the authority');
      } else {
        if (existsSync(path)) localPath(root, path);
        writeFileSync(path, content);
      }
      result = { status: checking ? 'pass' : 'generated', outputs: ['generated/theme.css', 'generated/catalog.md'] };
      break;
    }
    case 'feedback': result = updateFeedback(root, args[0], args.slice(1)); break;
    default: throw new Error('Commands: catalog, resolve, search, check, generate, feedback');
  }
  console.log(json(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
