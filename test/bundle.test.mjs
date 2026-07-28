import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

function trackedReleaseFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
    .toString()
    .split('\0')
    .filter(Boolean)
    .filter((file) => !file.startsWith('.git/'));
}

function releaseContents() {
  return trackedReleaseFiles()
    .filter((file) => !file.startsWith('test/'))
    .map((file) => ({ file, text: readFileSync(resolve(ROOT, file), 'utf8') }))
    .concat([{ file: 'manual-install/Code.gs', text: readFileSync(resolve(ROOT, 'manual-install/Code.gs'), 'utf8') }]);
}

function forbiddenReleaseHits(contents = releaseContents()) {
  const privateName = ['Rele', 'bogile'].join('');
  const maintainerName = ['Enzo', 'Snyman'].join(' ');
  const privateNames = [privateName, ['Gabi', 'sile'].join(''), ['Nt', 'lama'].join(''),
    ['Incep', 'tum'].join(''), ['lebo', 'snyman3'].join('')];
  const liveEmail = /[A-Z0-9._%+-]+@(?!(?:[A-Z0-9-]+\.)*example\.(?:test|com|org)\b)[A-Z][A-Z0-9-]*(?:\.[A-Z][A-Z0-9-]*)*\.[A-Z]{2,}/ig;
  const personalLinkedIn = /linkedin\.com\/in\/(?!your-handle(?:[/?#\s'".,)]|$))[A-Z0-9._-]+/ig;
  const apiKey = /(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{20,}|(?:api[_ -]?key|app[_ -]?key)["']?\s*[:=]\s*["']?(?!your[-_]|example|<)[A-Za-z0-9_-]{24,})/ig;
  const hits = [];

  for (const { file, text } of contents) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      const isLicenceAttribution = file === 'LICENSE' && line.includes('Copyright (c) 2026 ');
      if (!isLicenceAttribution && line.includes(maintainerName)) hits.push(`${file}:${index + 1}: maintainer name`);
      if (privateNames.some((name) => line.includes(name))) hits.push(`${file}:${index + 1}: private name`);
      if (personalLinkedIn.test(line)) hits.push(`${file}:${index + 1}: personal LinkedIn URL`);
      personalLinkedIn.lastIndex = 0;
      if (liveEmail.test(line)) hits.push(`${file}:${index + 1}: live-looking email`);
      liveEmail.lastIndex = 0;
      if (apiKey.test(line)) hits.push(`${file}:${index + 1}: API-key pattern`);
      apiKey.lastIndex = 0;
    });
  }
  return hits;
}

test('tracked release content contains no maintainer PII, personal LinkedIn URL, live email, or API key', () => {
  assert.deepEqual(forbiddenReleaseHits(), []);
});

test('release scan flags ordinary gmail and common two-label live email domains', () => {
  const hits = forbiddenReleaseHits([{
    file: 'fixture.txt',
    text: 'Contact person@gmail.com\nhiring@company.co.uk\nrecruiter@agency.com.au'
  }]);
  assert.deepEqual(hits, [
    'fixture.txt:1: live-looking email',
    'fixture.txt:2: live-looking email',
    'fixture.txt:3: live-looking email'
  ]);
});

test('bundle order includes Runtime and Validation exactly once and bundle sections match', () => {
  const bundleScript = readFileSync(resolve(ROOT, 'tools/bundle.sh'), 'utf8');
  const orderedNames = parseOrderAssignment(bundleScript);
  const bundle = readFileSync(resolve(ROOT, 'manual-install/Code.gs'), 'utf8');
  for (const name of ['Runtime', 'Validation']) {
    assert.equal(orderedNames.filter((item) => item === name).length, 1, `${name} must be ordered once`);
    assert.equal((bundle.match(new RegExp(`^// ${name}\\.gs$`, 'gm')) || []).length, 1,
      `${name} must appear once in the generated bundle`);
  }
});
