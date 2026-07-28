import { strict as assert } from 'node:assert';
import { chmodSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SCRIPT = join(ROOT, 'scripts', 'make-release.sh');

function runRelease(extraEnv = {}, version = '2099-12-31') {
  return spawnSync('bash', [SCRIPT, version], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8'
  });
}

function temporaryOutput() {
  return mkdtempSync(join(tmpdir(), 'job-hunt-release-test-'));
}

test('make-release refuses a dirty working tree before creating output', () => {
  const marker = join(ROOT, '.release-test-dirty-marker');
  writeFileSync(marker, 'test-only');
  try {
    const output = temporaryOutput();
    const result = runRelease({ RELEASE_DIR: output }, '2099-12-30');
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /clean|uncommitted|dirty/i);
    assert.deepEqual(readdirSync(output), []);
    rmSync(output, { recursive: true, force: true });
  } finally {
    rmSync(marker, { force: true });
  }
});

test('make-release writes provenance and only committed files to a temporary zip', () => {
  const output = temporaryOutput();
  try {
    const result = runRelease({ RELEASE_DIR: output }, '2099-12-31');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const zip = join(output, 'job-hunt-autopilot-2099-12-31.zip');
    assert.ok(readFileSync(zip).length > 0);

    const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
    assert.match(listing, /^job-hunt-autopilot\/VERSION\.txt$/m);
    assert.match(listing, /^job-hunt-autopilot\/manual-install\/Code\.gs$/m);
    assert.doesNotMatch(listing, /release-test-dirty-marker/);

    const extract = mkdtempSync(join(tmpdir(), 'job-hunt-release-extract-'));
    try {
      execFileSync('unzip', ['-q', zip, '-d', extract]);
      const versionText = readFileSync(join(extract, 'job-hunt-autopilot', 'VERSION.txt'), 'utf8');
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
      assert.match(versionText, /^Release version: 2099-12-31$/m);
      assert.match(versionText, new RegExp(`^Source commit: ${commit}$`, 'm'));
      assert.equal(readFileSync(join(extract, 'job-hunt-autopilot', 'manual-install', 'Code.gs'), 'utf8'),
        readFileSync(join(ROOT, 'manual-install', 'Code.gs'), 'utf8'));
    } finally {
      rmSync(extract, { recursive: true, force: true });
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('make-release rejects a tracked release secret in a disposable repository', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'job-hunt-release-fixture-'));
  try {
    cpSync(ROOT, fixture, { recursive: true, filter: (source) => !source.includes('/.git') });
    execFileSync('git', ['init', '-q'], { cwd: fixture });
    execFileSync('git', ['config', 'user.email', 'release-test@example.test'], { cwd: fixture });
    execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: fixture });
    execFileSync('git', ['add', '-A'], { cwd: fixture });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: fixture });
    writeFileSync(join(fixture, 'README.md'), `${readFileSync(join(fixture, 'README.md'), 'utf8')}\nAIzaSyA${'a'.repeat(30)}\n`);
    execFileSync('git', ['add', 'README.md'], { cwd: fixture });
    execFileSync('git', ['commit', '-qm', 'fixture secret'], { cwd: fixture });
    const output = mkdtempSync(join(tmpdir(), 'job-hunt-release-output-'));
    try {
      const result = spawnSync('bash', [join(fixture, 'scripts', 'make-release.sh'), '2099-12-29'], {
        cwd: fixture,
        env: { ...process.env, RELEASE_DIR: output },
        encoding: 'utf8'
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /secret|PII|forbidden|release content/i);
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
