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

function loadSources({ fetch = () => response(200, {}), properties = {}, boards = [], existing = [] } = {}) {
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
        adzunaQueries: () => ['support'],
        jsearchQueries: () => ['support'],
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
        appendRow: (...args) => rows.push(args)
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
  assert.match(Sources.lastFailureReport_[0], /^JSearch: source request failed$/);
  assert.equal(logs.some((line) => line.includes('rapid-secret') || line.includes('private.example.test')), false);
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
      Gemini: { generate: () => 'ok' },
      Crm: { readAll: () => [] }
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
