import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the bundle ORDER covers every source file exactly once', () => {
  const bundleScript = readFileSync(resolve(ROOT, 'tools/bundle.sh'), 'utf8');
  const orderMatch = bundleScript.match(/\bORDER=\(([^)]*)\)/s);

  assert.ok(orderMatch, 'tools/bundle.sh must define an ORDER array');

  const orderedNames = orderMatch[1].match(/\b[A-Za-z][A-Za-z0-9_]*\b/g) ?? [];
  const duplicateNames = orderedNames.filter((name, index) => orderedNames.indexOf(name) !== index);
  assert.deepEqual(duplicateNames, [], 'ORDER must not repeat source names');

  const sourceNames = readdirSync(resolve(ROOT, 'src'))
    .filter((file) => file.endsWith('.gs'))
    .map((file) => basename(file, '.gs'))
    .sort();

  assert.deepEqual(
    [...orderedNames].sort(),
    sourceNames,
    'ORDER must list every src/*.gs file exactly once'
  );
});
