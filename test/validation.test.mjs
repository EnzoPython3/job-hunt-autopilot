import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadGs } from './helpers/load-gs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { Validation } = loadGs(resolve(ROOT, 'src/Validation.gs'), {
  names: ['Validation']
});

test('Validation loads and parses HTTPS URLs without a URL Web API global', () => {
  assert.equal(Validation.safeHttpsUrl('https://example.com/jobs'), 'https://example.com/jobs');
});

test('safeHttpsUrl accepts and normalises HTTPS URLs', () => {
  assert.equal(
    Validation.safeHttpsUrl('HTTPS://Example.COM:443/jobs/../openings?id=7#apply'),
    'https://example.com/openings?id=7#apply'
  );
  assert.equal(Validation.safeHttpsUrl('https://jobs.example.test/path?q=a%20b'), 'https://jobs.example.test/path?q=a%20b');
  assert.equal(Validation.safeHttpsUrl('https://[2001:db8::1]/jobs'), 'https://[2001:db8::1]/jobs');
  assert.equal(Validation.safeHttpsUrl('https://[::1]:443/jobs'), 'https://[::1]/jobs');
  assert.equal(Validation.safeHttpsUrl('https://[::ffff:192.0.2.128]/'), 'https://[::ffff:192.0.2.128]/');
});

test('safeHttpsUrl rejects invalid dotted IPv4 authorities and IPv4-embedded IPv6 octets', () => {
  for (const value of [
    'https://999.999.999.999/',
    'https://256.1.1.1/',
    'https://192.0.2.256/',
    'https://192.0.2.1.4/',
    'https://[::ffff:999.0.2.128]/',
    'https://[::ffff:192.0.2.999]/',
    'https://[::ffff:192.0.2.1.4]/'
  ]) {
    assert.equal(Validation.safeHttpsUrl(value), '', `expected rejection for ${value}`);
  }
});

test('safeHttpsUrl rejects malformed bracketed IPv6 hosts', () => {
  for (const value of [
    'https://[:::1]/',
    'https://[1:2:3:4:5:6:7:8:9]/',
    'https://[1::2::3]/'
  ]) {
    assert.equal(Validation.safeHttpsUrl(value), '', `expected rejection for ${value}`);
  }
});

test('safeHttpsUrl rejects unsafe schemes, malformed values, empty values, and credentials', () => {
  for (const value of [
    '',
    '   ',
    null,
    undefined,
    'http://example.com/job',
    'javascript:alert(1)',
    'data:text/html,<h1>no</h1>',
    'file:///etc/passwd',
    'https://user:pass@example.com/job',
    'https://user@example.com/job',
    'https://@example.com/job',
    'https://:password@example.com/job',
    'https://',
    'not a URL',
    'https://example.com/\nredirect',
    ' https://example.com/job',
    'https://example.com/job path',
    'https://example..com/job',
    'https://-example.com/job',
    'https://example-.com/job',
    'https://example.com:',
    'https://example.com:abc/job',
    'https://[::1/job'
  ]) {
    assert.equal(Validation.safeHttpsUrl(value), '', `expected rejection for ${String(value)}`);
  }
});

test('safeHttpsUrl allows only HTTPS redirect targets after the caller resolves them', () => {
  assert.equal(Validation.safeHttpsUrl('https://jobs.example.com/apply'), 'https://jobs.example.com/apply');
  assert.equal(Validation.safeHttpsUrl('https://careers.example.com/apply'), 'https://careers.example.com/apply');
  assert.equal(Validation.safeHttpsUrl('http://careers.example.com/apply'), '');
  assert.equal(Validation.safeHttpsUrl('javascript:alert(1)'), '');
  assert.equal(Validation.safeHttpsUrl('data:text/html,nope'), '');
});

test('safeHref returns an HTML-safe href only for a validated HTTPS URL', () => {
  assert.equal(
    Validation.safeHref('https://example.com/jobs?a=1&b=2'),
    'https://example.com/jobs?a=1&amp;b=2'
  );
  assert.equal(Validation.safeHref('HTTPS://Example.COM/a/<b>'), 'https://example.com/a/%3Cb%3E');
  assert.equal(Validation.safeHref('javascript:alert(1)'), '');
  assert.equal(Validation.safeHref('http://example.com/?next=https://safe.example'), '');
  assert.equal(Validation.safeHref('https://user:pass@example.com/'), '');
});

test('isEmail accepts ordinary recipient addresses', () => {
  for (const value of [
    'person@example.com',
    'first.last+jobs@sub.example.co.za',
    'a_b-c@example.test'
  ]) {
    assert.equal(Validation.isEmail(value), true, `expected acceptance for ${value}`);
  }
});

test('isEmail rejects control characters, whitespace injection, malformed and unsafe values', () => {
  for (const value of [
    '',
    null,
    undefined,
    'person@example.com\nBcc: attacker@example.com',
    'person@example.com\r\nBcc: attacker@example.com',
    'person @example.com',
    'person@example .com',
    'person@example.com ',
    'person@example.com,attacker@example.com',
    'Person <person@example.com>',
    'person@@example.com',
    'person@',
    '@example.com',
    'person.example.com',
    'javascript:alert(1)@example.com',
    'a'.repeat(250) + '@example.com'
  ]) {
    assert.equal(Validation.isEmail(value), false, `expected rejection for ${JSON.stringify(value)}`);
  }
});

test('safeHttpsUrl and isEmail reject C1 control characters', () => {
  for (const control of ['\u0080', '\u009f']) {
    assert.equal(Validation.safeHttpsUrl('https://example.com/' + control), '');
    assert.equal(Validation.isEmail('person' + control + '@example.com'), false);
  }
});

test('requireArray and requireObject accept expected JSON values', () => {
  const array = ['candidate'];
  const object = { candidates: array };
  assert.equal(Validation.requireArray(array, 'candidates'), array);
  assert.equal(Validation.requireObject(object, 'response'), object);
});

test('requireArray and requireObject reject unexpected types with bounded labelled errors', () => {
  assert.throws(() => Validation.requireArray({ huge: 'x'.repeat(10000) }, 'candidates'), (error) => {
    assert.match(error.message, /^candidates must be an array$/);
    assert.ok(error.message.length < 100);
    return true;
  });
  assert.throws(() => Validation.requireObject([], 'response'), /response must be an object/);
  assert.throws(() => Validation.requireObject(null, 'response'), /response must be an object/);
});

test('validateGeminiTextResponse joins text-bearing parts from a valid envelope', () => {
  const response = {
    candidates: [{
      content: {
        parts: [{ text: 'First ' }, { inlineData: { mimeType: 'image/png' } }, { text: 'second.' }]
      }
    }]
  };
  assert.equal(Validation.validateGeminiTextResponse(response), 'First second.');
});

test('validateGeminiTextResponse rejects malformed envelopes and unexpected types', () => {
  for (const value of [
    null,
    [],
    'response',
    {},
    { candidates: null },
    { candidates: [] },
    { candidates: [{}] },
    { candidates: [{ content: null }] },
    { candidates: [{ content: { parts: [] } }] },
    { candidates: [{ content: { parts: [{ inlineData: {} }] } }] },
    { candidates: [{ content: { parts: [{ text: 42 }] } }] }
  ]) {
    assert.throws(
      () => Validation.validateGeminiTextResponse(value),
      /Gemini response|candidates|content|parts|text/,
      `expected malformed envelope rejection for ${JSON.stringify(value)}`
    );
  }
});

test('safeHttpsUrl accepts only HTTPS job links without credentials', () => {
  assert.equal(Validation.safeHttpsUrl('https://jobs.example.test/apply?id=1'), 'https://jobs.example.test/apply?id=1');
  for (const value of [
    'http://jobs.example.test/apply',
    'javascript:alert(1)',
    'data:text/html,hello',
    'https://user:pass@jobs.example.test/apply',
    'https://jobs.example.test:bad/apply',
    'https://[bad/apply'
  ]) {
    assert.equal(Validation.safeHttpsUrl(value), '', `expected rejection for ${value}`);
  }
});

test('safeHttpsUrl resolves only HTTPS redirect targets', () => {
  assert.equal(Validation.safeHttpsUrl('https://jobs.example.test/next'), 'https://jobs.example.test/next');
  assert.equal(Validation.safeHttpsUrl('http://jobs.example.test/next'), '');
});

test('morning digest only emits validated HTTPS anchors', () => {
  const sent = [];
  const { morningDigest } = loadGs(resolve(ROOT, 'src/Digest.gs'), {
    services: {
      SpreadsheetApp: { openById: () => ({ getUrl: () => 'https://sheets.example.test/id' }) },
      MailApp: { sendEmail: (message) => sent.push(message) },
      Logger: { log: () => {} }
    },
    globals: {
      Validation: { safeHref: (value) => value === 'https://safe.example.test/job' ? 'https://safe.example.test/job' : '' },
      Config: {
        KEYS: { SHEET_ID: 'SHEET_ID' },
        require: () => 'sheet-id',
        candidate: () => ({ firstName: '<Candidate>', email: 'candidate@example.test' })
      },
      Crm: {
        ensureSchema: () => {},
        TABS: { APPROVALS: 'Approvals' },
        readAll: () => [
          { fit_score: 90, role: '<Role>', company: '& Co', track: 'email', url: 'https://safe.example.test/job', decision: '' },
          { fit_score: 80, role: 'Bad', company: 'Bad', track: 'portal', url: 'javascript:alert(1)', decision: '' }
        ]
      },
      Alerts: { notify: () => {} }
    },
    names: ['morningDigest']
  });
  morningDigest();
  assert.equal(sent.length, 1);
  assert.match(sent[0].htmlBody, /https:\/\/safe\.example\.test\/job/);
  assert.equal(sent[0].htmlBody.includes('javascript:'), false);
  assert.match(sent[0].htmlBody, /&lt;Role&gt;/);
  assert.match(sent[0].htmlBody, /&amp; Co/);
});

test('weekly KPI upsert is locked and derives the week in spreadsheet timezone', () => {
  const events = [];
  const rows = [{ _row: 2, week_start: '2026-07-27', sourced: 1 }];
  const Report = loadGs(resolve(ROOT, 'src/Report.gs'), {
    services: {
      Utilities: { formatDate: (date, tz) => {
        assert.equal(tz, 'America/Los_Angeles');
        return date instanceof Date ? '2026-07-27' : '';
      } }
    },
    globals: {
      Runtime: { withScriptLock: (name, wait, fn) => { events.push([name, wait]); return fn(); } },
      Crm: {
        TABS: { KPIS: 'KPIs' },
        ss_: () => ({ getSpreadsheetTimeZone: () => 'America/Los_Angeles' }),
        readAll: () => rows,
        updateRow: (tab, row, value) => { events.push(['update', tab, row, value]); },
        appendRow: () => { throw new Error('duplicate KPI row'); }
      }
    },
    names: ['Report']
  }).Report;
  Report.writeKpiRow_({ sourced: 2, scored: 2, queued: 1, approved: 1, submitted: 0, sent: 0, responses: 0, interviews: 0 });
  assert.deepEqual(events[0], ['weekly-kpi', 5000]);
  assert.equal(events[1][0], 'update');
  assert.equal(events[1][2], 2);
});
