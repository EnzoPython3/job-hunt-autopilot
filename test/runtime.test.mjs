import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadGs } from './helpers/load-gs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadConfig(properties = {}, configRows = []) {
  return loadGs(resolve(ROOT, 'src/Config.gs'), {
    services: {
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (key) => Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null,
          setProperty: (key, value) => { properties[key] = String(value); },
          deleteProperty: (key) => { delete properties[key]; }
        })
      },
      Crm: { readAll: () => configRows },
      Logger: { log: () => {} }
    },
    names: ['Config']
  }).Config;
}

test('Config clamps excessive runtime tunables to safe maxima', () => {
  const Config = loadConfig({
    CHUNK_SIZE: '9999',
    DAILY_SOURCE_CAP: '9999',
    DAILY_APPROVAL_N: '9999',
    AGENCY_DRAFTS_PER_RUN: '9999',
    MAINTENANCE_CHECKS: '9999'
  });

  assert.equal(Config.tunable('CHUNK_SIZE'), Config.MAXIMA.CHUNK_SIZE);
  assert.equal(Config.tunable('DAILY_SOURCE_CAP'), Config.MAXIMA.DAILY_SOURCE_CAP);
  assert.equal(Config.tunable('DAILY_APPROVAL_N'), Config.MAXIMA.DAILY_APPROVAL_N);
  assert.equal(Config.tunable('AGENCY_DRAFTS_PER_RUN'), Config.MAXIMA.AGENCY_DRAFTS_PER_RUN);
  assert.equal(Config.tunable('MAINTENANCE_CHECKS'), Config.MAXIMA.MAINTENANCE_CHECKS);
});

test('Config rejects negative and non-numeric runtime tunables by using safe defaults', () => {
  const Config = loadConfig({
    CHUNK_SIZE: '-1',
    DAILY_SOURCE_CAP: 'not-a-number',
    AGENCY_DRAFTS_PER_RUN: '0'
  });

  assert.equal(Config.tunable('CHUNK_SIZE'), Config.defaults.CHUNK_SIZE);
  assert.equal(Config.tunable('DAILY_SOURCE_CAP'), Config.defaults.DAILY_SOURCE_CAP);
  assert.equal(Config.tunable('AGENCY_DRAFTS_PER_RUN'), Config.defaults.AGENCY_DRAFTS_PER_RUN);
});

test('Config exposes every supported property name, including filters, alerts, and Adzuna alias', () => {
  const Config = loadConfig();
  for (const key of [
    'GEMINI_API_KEY', 'GEMINI_MODEL', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'ADZUNA_API_KEY',
    'RAPIDAPI_KEY', 'SHEET_ID', 'DRIVE_FOLDER_ID', 'MASTER_CV_DOC_ID', 'CANDIDATE_JSON',
    'ALERT_EMAIL', 'ALLOWED_REGIONS', 'EXCLUDED_REGIONS', 'VAGUE_LOCATION_TAGS',
    'ALLOW_REMOTE', 'EXCLUDED_DOMAINS', 'TAILOR_FOR_PORTALS', 'AGENCIES_CSV'
  ]) assert.equal(Config.KEYS[key], key, key);
});

test('Onboarding property fields use the central Config key map', () => {
  const Config = loadConfig();
  const { SETUP_FIELDS } = loadGs(resolve(ROOT, 'src/Onboarding.gs'), {
    globals: { Config },
    names: ['SETUP_FIELDS']
  });
  const propertyTargets = SETUP_FIELDS.filter((field) => field.type === 'prop').map((field) => field.target);
  assert.deepEqual(propertyTargets, [
    Config.KEYS.GEMINI_API_KEY,
    Config.KEYS.ADZUNA_APP_ID,
    Config.KEYS.ADZUNA_APP_KEY,
    Config.KEYS.RAPIDAPI_KEY,
    Config.KEYS.MASTER_CV_DOC_ID,
    Config.KEYS.ALERT_EMAIL,
    Config.KEYS.ALLOWED_REGIONS,
    Config.KEYS.EXCLUDED_REGIONS,
    Config.KEYS.ALLOW_REMOTE,
    Config.KEYS.EXCLUDED_DOMAINS,
    Config.KEYS.TAILOR_FOR_PORTALS
  ]);
});

test('Match limits new approval rows per scoring run', () => {
  const updates = [];
  const approvals = [];
  const opportunities = Array.from({ length: 4 }, (_, i) => ({
    _row: i + 2, id: `opp-${i}`, company: 'Example', role: 'Support', location: 'Remote',
    mode: 'remote', url: `https://example.test/job/${i}`
  }));
  const Match = loadGs(resolve(ROOT, 'src/Match.gs'), {
    globals: {
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => ({ fit_score: 90, track: 'support', rationale: 'good fit' }) },
      Config: {
        promptCandidate: () => ({ name: 'Candidate' }),
        tunable: (key) => ({ CHUNK_SIZE: 10, SCORE_THRESHOLD: 62, DAILY_APPROVAL_N: 2 }[key]),
        defaults: { DAILY_APPROVAL_N: 2 }
      },
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' },
        listByStatus: () => opportunities,
        updateRow: (...args) => updates.push(args),
        appendRow: (...args) => approvals.push(args)
      },
      Logger: { log: () => {} }
    },
    names: ['Match']
  }).Match;

  const result = Match.scoreQueue();
  assert.equal(result.scored, 4);
  assert.equal(result.queued, 2);
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0][1].id, 'opp-0');
  assert.equal(approvals[1][1].id, 'opp-1');
  assert.equal(updates.filter((args) => args[2].status === 'queued_for_approval').length, 2);
  assert.equal(updates.filter((args) => args[2].status === 'scored').length, 2);
});
