import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadGs } from './helpers/load-gs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const Validation = loadGs(resolve(ROOT, 'src/Validation.gs'), { names: ['Validation'] }).Validation;

function response(code, body, headers = {}) {
  return {
    getResponseCode: () => code,
    getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
    getAllHeaders: () => headers
  };
}

function loadSources({ fetch = () => response(200, {}), properties = {}, boards = [], existing = [], adzunaQueries = ['support'], jsearchQueries = ['support'], lock = null, now = () => Date.now(), stop = null, findChecks = [] } = {}) {
  const logs = [];
  const alerts = [];
  const rows = [];
  const Sources = loadGs(resolve(ROOT, 'src/Sources.gs'), {
    services: {
      UrlFetchApp: { fetch },
      Logger: { log: (value) => logs.push(String(value)) },
      Utilities: {
        DigestAlgorithm: { MD5: 'MD5' },
        computeDigest: () => [1, 2, 3, 4]
      }
    },
    globals: {
      Validation,
      Config: {
        KEYS: { ADZUNA_APP_ID: 'ADZUNA_APP_ID', ADZUNA_APP_KEY: 'ADZUNA_APP_KEY', RAPIDAPI_KEY: 'RAPIDAPI_KEY' },
        get: (key) => properties[key] || null,
        tunable: () => 10,
        atsBoards: () => boards,
        adzunaCountries: () => ['za'],
        adzunaQueries: () => adzunaQueries,
        jsearchQueries: () => jsearchQueries,
        jsearchDatePosted: () => 'week',
        allowRemote: () => true,
        excludedRegions: () => [],
        allowedRegions: () => [],
        vagueLocationTags: () => [],
        excludedDomains: () => []
      },
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities' },
        readAll: () => existing,
        appendRow: (...args) => { rows.push(args); existing.push(args[1]); },
        findOpportunity: (id) => { findChecks.push(id); return existing.find((row) => row.id === id) || null; }
      },
      Runtime: {
        deadlineMs: () => now() + 300000,
        shouldStop: (deadline) => stop ? stop(deadline) : now() >= deadline,
        withScriptLock: (_name, _wait, fn) => lock ? lock(fn) : fn()
      },
      Outreach: { harvestEmail_: () => '' },
      Alerts: { notify: (...args) => alerts.push(args) }
    },
    names: ['Sources']
  }).Sources;
  return { Sources, logs, alerts, rows };
}

test('pickJobs_ treats null, objects, and missing arrays as empty', () => {
  const { Sources } = loadSources();
  for (const value of [null, {}, { data: {} }, { data: null }, { jobs: {} }, { results: {} }]) {
    assert.equal(Sources.pickJobs_(value).length, 0);
  }
});

test('ATS adapters skip malformed rows and preserve valid rows', () => {
  const { Sources } = loadSources({
    fetch: () => response(200, {
      jobs: [
        null,
        {},
        { title: 'Valid role', absolute_url: 'https://jobs.example.test/1', location: { name: 'Remote' } },
        { title: 'Unsafe role', absolute_url: 'http://jobs.example.test/2' }
      ]
    })
  });
  const jobs = Sources.fromGreenhouse_('example');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].role, 'Valid role');
  assert.equal(jobs[0].url, 'https://jobs.example.test/1');
});

test('ATS adapters return empty for null, object, and missing-array envelopes', () => {
  for (const body of [null, {}, { jobs: {} }]) {
    const { Sources } = loadSources({ fetch: () => response(200, body) });
    assert.equal(Sources.fromGreenhouse_('example').length, 0);
    assert.equal(Sources.fromLever_('example').length, 0);
    assert.equal(Sources.fromAshby_('example').length, 0);
    assert.equal(Sources.fromWorkable_('example').length, 0);
  }
});

test('all source adapters skip malformed individual rows', () => {
  const fixtures = [
    ['adzuna', { results: [null, {}, { title: 'Adzuna role', redirect_url: 'https://jobs.example.test/a' }] }],
    ['lever', [null, {}, { text: 'Lever role', hostedUrl: 'https://jobs.example.test/l' }]],
    ['ashby', { jobs: [null, {}, { title: 'Ashby role', jobUrl: 'https://jobs.example.test/as' }] }],
    ['workable', { jobs: [null, {}, { title: 'Workable role', url: 'https://jobs.example.test/w' }] }]
  ];
  for (const [type, body] of fixtures) {
    const { Sources } = loadSources({
      properties: type === 'adzuna' ? { ADZUNA_APP_ID: 'app-id', ADZUNA_APP_KEY: 'app-key' } : {},
      fetch: () => response(200, body)
    });
    const jobs = type === 'adzuna' ? Sources.fromAdzuna()
      : Sources.fromAts({ type, slug: 'example' });
    assert.equal(jobs.length, 1, type);
  }
});

test('resolveUrl_ enforces HTTPS and certificate validation for redirects', () => {
  const calls = [];
  const { Sources } = loadSources({
    fetch: (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response(302, '', { Location: 'http://evil.example.test/job' });
      throw new Error('unsafe redirect was followed');
    }
  });
  const result = Sources.resolveUrl_('https://redirect.example.test/job');
  assert.equal(result.alive, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.validateHttpsCertificates, true);
});

test('resolveUrl_ rejects non-HTTPS meta-refresh targets', () => {
  const calls = [];
  const { Sources } = loadSources({
    fetch: (url, options) => {
      calls.push({ url, options });
      return response(200, '<meta http-equiv="refresh" content="0;url=http://evil.example.test/job">');
    }
  });
  const result = Sources.resolveUrl_('https://redirect.example.test/job');
  assert.equal(result.alive, false);
  assert.equal(calls.length, 1);
});

test('ingest skips malformed source rows without aborting valid source rows', () => {
  const { Sources, rows } = loadSources({
    properties: { RAPIDAPI_KEY: 'rapid-test-key' },
    fetch: () => response(200, { data: [
      null,
      {},
      { employer_name: 'Example', job_title: 'Valid role', job_apply_link: 'https://jobs.example.test/1' },
      { employer_name: 'Unsafe', job_title: 'Unsafe role', job_apply_link: 'javascript:alert(1)' }
    ] })
  });
  assert.equal(Sources.ingest(10), 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1].url, 'https://jobs.example.test/1');
});

test('ingest exposes a bounded source failure summary and does not log secrets, URLs, or bodies', () => {
  const logs = [];
  const { Sources } = loadSources({
    properties: { RAPIDAPI_KEY: 'rapid-secret' },
    fetch: () => { throw new Error('body contains rapid-secret and https://private.example.test/x'); }
  });
  assert.throws(() => Sources.ingest(10), /Source ingest failed: 1 source failure/);
  assert.ok(Sources.lastFailureReport_);
  assert.equal(Sources.lastFailureReport_.length, 1);
  assert.match(Sources.lastFailureReport_[0], /^JSearch(?: support)?: source request failed$/);
  assert.equal(logs.some((line) => line.includes('rapid-secret') || line.includes('private.example.test')), false);
});

test('Adzuna records per-request failures while retaining valid rows from later requests', () => {
  let calls = 0;
  const { Sources } = loadSources({
    properties: { ADZUNA_APP_ID: 'app-id', ADZUNA_APP_KEY: 'app-key' },
    adzunaQueries: ['broken', 'valid'],
    fetch: () => {
      calls++;
      return calls === 1
        ? response(503, 'provider failure with secret app-key')
        : response(200, { results: [{ title: 'Valid Adzuna role', redirect_url: 'https://jobs.example.test/a' }] });
    }
  });
  const jobs = Sources.fromAdzuna();
  assert.equal(jobs.length, 1);
  assert.equal(Sources.lastFailureReport_.length, 1);
  assert.match(Sources.lastFailureReport_[0], /^Adzuna za\/broken: source request failed$/);
});

test('JSearch records malformed JSON per request while retaining later valid rows', () => {
  let calls = 0;
  const { Sources } = loadSources({
    properties: { RAPIDAPI_KEY: 'rapid-secret' },
    jsearchQueries: ['broken', 'valid'],
    fetch: () => {
      calls++;
      return calls === 1
        ? response(200, '{"data":')
        : response(200, { data: [{ employer_name: 'Example', job_title: 'Valid JSearch role', job_apply_link: 'https://jobs.example.test/j' }] });
    }
  });
  const jobs = Sources.fromJSearch_();
  assert.equal(jobs.length, 1);
  assert.equal(Sources.lastFailureReport_.length, 1);
  assert.match(Sources.lastFailureReport_[0], /^JSearch broken: source request failed$/);
});

test('source JSON parsing rejects oversized response bodies without logging contents', () => {
  const loaded = loadSources({
    properties: { RAPIDAPI_KEY: 'rapid-secret' },
    fetch: () => response(200, 'x'.repeat(250001))
  });
  const Sources = loaded.Sources;
  const logs = loaded.logs;
  assert.equal(Sources.fromJSearch_().length, 0);
  assert.match(Sources.lastFailureReport_[0], /^JSearch support: source request failed$/);
  assert.throws(() => Sources.responseBody_({ getContentText: () => 'x'.repeat(250001) }), /source response too large/);
  assert.equal(logs.some((line) => line.includes('x'.repeat(100)) || line.includes('rapid-secret')), false);
});

test('diagnostics report only secret state and bounded status, never secret values or response bodies', () => {
  const logs = [];
  const secret = 'diagnostic-secret';
  const { Sources } = loadSources({ properties: { RAPIDAPI_KEY: secret } });
  const diagnostics = loadGs(resolve(ROOT, 'src/Diagnostics.gs'), {
    services: {
      PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === 'RAPIDAPI_KEY' ? secret : null }) },
      UrlFetchApp: { fetch: () => response(403, 'body with diagnostic-secret and https://private.example.test/x') },
      Logger: { log: (value) => logs.push(String(value)) }
    },
    globals: {
      Sources,
      Config: { tunable: () => 2 },
      Gemini: { generate: () => 'ok' },
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' }, readAll: () => [], updateRow: () => {} },
      Alerts: { notify: () => {} }
    },
    names: ['diagnose']
  }).diagnose;
  const report = diagnostics();
  assert.match(report, /RAPIDAPI_KEY: SET/);
  assert.equal(report.includes(secret), false);
  assert.equal(report.includes('diagnostic-secret'), false);
  assert.equal(report.includes('private.example.test'), false);
  assert.equal(report.length < 1800, true);
});

test('pruneDeadLinks uses the configured maintenance check cap', () => {
  const { Sources } = loadSources();
  const rows = [
    { _row: 2, url: 'https://jobs.example.test/1', status: 'sourced' },
    { _row: 3, url: 'https://jobs.example.test/2', status: 'sourced' },
    { _row: 4, url: 'https://jobs.example.test/3', status: 'sourced' }
  ];
  const diagnostics = loadGs(resolve(ROOT, 'src/Diagnostics.gs'), {
    services: { Logger: { log: () => {} } },
    globals: {
      Sources,
      Config: { tunable: (key) => key === 'MAINTENANCE_CHECKS' ? 2 : 2 },
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' }, ensureSchema: () => {}, readAll: (tab) => tab === 'Opportunities' ? rows : [], updateRow: () => {} },
      Alerts: { notify: () => {} }
    },
    names: ['pruneDeadLinks']
  }).pruneDeadLinks;
  const report = diagnostics();
  assert.match(report, /CAPPED/);
  assert.match(report, /2-check/);
  assert.equal(report.includes('80-check'), false);
});

test('ingest serialises append phase and rechecks stable IDs before every append', () => {
  const events = [];
  const existing = [];
  const findChecks = [];
  const loaded = loadSources({
    properties: { RAPIDAPI_KEY: 'rapid-test-key' },
    fetch: () => response(200, { data: [
      { employer_name: 'Example', job_title: 'First role', job_apply_link: 'https://jobs.example.test/1' },
      { employer_name: 'Example', job_title: 'Second role', job_apply_link: 'https://jobs.example.test/2' }
    ] }),
    existing,
    findChecks,
    lock: (fn) => { events.push('lock-start'); const result = fn(); events.push('lock-end'); return result; }
  });
  loaded.Sources.hashId_ = (_source, _company, role) => role;
  const crm = loaded.rows;
  const result = loaded.Sources.ingest(10);
  assert.equal(result, 2);
  assert.deepEqual(events, ['lock-start', 'lock-end', 'lock-start', 'lock-end']);
  assert.equal(crm.length, 2);
  assert.equal(findChecks.length, 2);
});

test('source adapters stop before a network request when the deadline expires', () => {
  let calls = 0;
  const { Sources } = loadSources({
    properties: { RAPIDAPI_KEY: 'rapid-test-key' },
    jsearchQueries: ['one', 'two'],
    stop: () => true,
    fetch: () => { calls++; return response(200, { data: [] }); }
  });
  assert.equal(Sources.fromJSearch_(400000).length, 0);
  assert.equal(calls, 0);
});
