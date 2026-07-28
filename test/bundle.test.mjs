import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseOrderAssignment(script) {
  const assignment = script.match(/^[ \t]*ORDER[ \t]*=[ \t]*\(/m);
  assert.ok(assignment, 'tools/bundle.sh must define an ORDER array assignment');

  const names = [];
  let token = '';
  let cursor = assignment.index + assignment[0].length;
  let closed = false;

  const flush = () => {
    if (!token) return;
    assert.match(token, /^[A-Za-z_][A-Za-z0-9_]*$/, `invalid ORDER token: ${token}`);
    names.push(token);
    token = '';
  };

  while (cursor < script.length) {
    const character = script[cursor];
    if (character === ')') {
      flush();
      closed = true;
      break;
    }
    if (/\s/.test(character)) {
      flush();
      cursor++;
      continue;
    }
    if (character === '\\' && (script[cursor + 1] === '\n' ||
        (script[cursor + 1] === '\r' && script[cursor + 2] === '\n'))) {
      cursor += script[cursor + 1] === '\r' ? 3 : 2;
      continue;
    }
    assert.match(character, /[A-Za-z0-9_]/, `invalid ORDER syntax near: ${character}`);
    token += character;
    cursor++;
  }

  assert.ok(closed, 'ORDER assignment must have a closing parenthesis');
  return names;
}

test('the bundle ORDER covers every source file exactly once', () => {
  const bundleScript = readFileSync(resolve(ROOT, 'tools/bundle.sh'), 'utf8');
  const orderedNames = parseOrderAssignment(bundleScript);
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

test('ORDER parsing ignores comments and shell syntax outside the assignment', () => {
  const script = [
    '# ORDER=(NotAnAssignment)',
    'echo "$(not part of ORDER)"',
    'ORDER=(Config Alerts)',
    'printf \'`also not part of ORDER`\''
  ].join('\n');

  assert.deepEqual(parseOrderAssignment(script), ['Config', 'Alerts']);
});

test('ORDER parsing rejects command substitutions and quoted tokens', () => {
  assert.throws(
    () => parseOrderAssignment('ORDER=(Config $(untrusted))'),
    /invalid ORDER syntax/
  );
  assert.throws(
    () => parseOrderAssignment('ORDER=(Config "Alerts")'),
    /invalid ORDER syntax/
  );
});
