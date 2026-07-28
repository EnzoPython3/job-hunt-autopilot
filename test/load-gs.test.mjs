import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadGs } from './helpers/load-gs.mjs';

const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = resolve(TEST_ROOT, '..');

test('loadGs rejects files outside the trusted test and src fixture roots', () => {
  assert.throws(
    () => loadGs(resolve(REPOSITORY_ROOT, 'README.md')),
    /outside trusted fixture roots/
  );
});
