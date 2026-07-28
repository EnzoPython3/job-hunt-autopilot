import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadGs } from './helpers/load-gs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadConfig(properties = {}, configRows = []) {
  if (!configRows.length) configRows = Object.entries(properties).map(([key, value]) => ({ key, value }));
  return loadGs(resolve(ROOT, 'src/Config.gs'), {
    services: {
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (key) => Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null,
          setProperty: (key, value) => { properties[key] = String(value); },
          deleteProperty: (key) => { delete properties[key]; }
        })
      },
      Crm: { TABS: { CONFIG: 'Config' }, readAll: () => configRows },
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
  assert.equal(JSON.stringify(propertyTargets), JSON.stringify([
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
  ]));
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
        upsertApproval: (obj) => { approvals.push(['Approvals', obj]); return obj; },
        findApproval: (id) => approvals.map((entry) => entry[1]).find((row) => row.id === id) || null
      },
      Logger: { log: () => {} }
    },
    names: ['Match']
  }).Match;

  const result = Match.scoreQueue();
  assert.equal(result.scored, 2);
  assert.equal(result.queued, 2);
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0][1].id, 'opp-0');
  assert.equal(approvals[1][1].id, 'opp-1');
  assert.equal(updates.filter((args) => args[2].status === 'queued_for_approval').length, 2);
  assert.equal(updates.length, 2);
});

test('Match claims each opportunity before Gemini and skips an active claim', () => {
  const events = [];
  const opportunity = {
    _row: 2, id: 'opp-active', company: 'Example', role: 'Support', location: 'Remote',
    mode: 'remote', url: 'https://example.test/job/active'
  };
  const Match = loadGs(resolve(ROOT, 'src/Match.gs'), {
    globals: {
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => { throw new Error('Gemini must not run'); } },
      Config: {
        promptCandidate: () => ({ name: 'Candidate' }),
        tunable: (key) => ({ CHUNK_SIZE: 1, SCORE_THRESHOLD: 62, DAILY_APPROVAL_N: 1 }[key])
      },
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' },
        listByStatus: () => [opportunity],
        claim: (...args) => { events.push(['claim', ...args]); return false; },
        releaseClaim: (...args) => events.push(['release', ...args]),
        updateRow: (...args) => events.push(['update', ...args]),
        upsertApproval: () => { throw new Error('approval must not run'); }
      },
      Logger: { log: () => {} }
    },
    names: ['Match']
  }).Match;

  const result = Match.scoreQueue(1);
  assert.equal(result.scored, 0);
  assert.equal(result.queued, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'claim');
  assert.equal(events[0][1], 'Opportunities');
  assert.equal(events[0][2], 'opp-active');
});

test('Match verifies the approval row before advancing the opportunity status', () => {
  const events = [];
  const opportunity = {
    _row: 2, id: 'opp-approved', company: 'Example', role: 'Support', location: 'Remote',
    mode: 'remote', url: 'https://example.test/job/approved'
  };
  const approval = { id: 'opp-approved', fit_score: 90, track: 'support', rationale: 'good fit' };
  const Match = loadGs(resolve(ROOT, 'src/Match.gs'), {
    globals: {
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => { events.push(['gemini']); return approval; } },
      Config: {
        promptCandidate: () => ({ name: 'Candidate' }),
        tunable: (key) => ({ CHUNK_SIZE: 1, SCORE_THRESHOLD: 62, DAILY_APPROVAL_N: 1 }[key])
      },
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' },
        listByStatus: () => [opportunity],
        claim: (...args) => { events.push(['claim', ...args]); return true; },
        releaseClaim: (...args) => events.push(['release', ...args]),
        upsertApproval: (...args) => { events.push(['upsert', ...args]); return approval; },
        findApproval: (...args) => { events.push(['verify', ...args]); return approval; },
        updateRow: (...args) => events.push(['update', ...args]),
      },
      Logger: { log: () => {} }
    },
    names: ['Match']
  }).Match;

  const result = Match.scoreQueue(1);
  assert.equal(result.scored, 1);
  assert.equal(result.queued, 1);
  assert.deepEqual(events.map((event) => event[0]), ['claim', 'gemini', 'upsert', 'verify', 'update', 'release']);
  assert.equal(events[4][3].status, 'queued_for_approval');
});

test('Match records a retryable scoring failure and releases the claim', () => {
  const events = [];
  const opportunity = {
    _row: 2, id: 'opp-retry', company: 'Example', role: 'Support', location: 'Remote',
    mode: 'remote', url: 'https://example.test/job/retry'
  };
  const Match = loadGs(resolve(ROOT, 'src/Match.gs'), {
    globals: {
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => { throw new Error('temporary Gemini failure'); } },
      Config: {
        promptCandidate: () => ({ name: 'Candidate' }),
        tunable: (key) => ({ CHUNK_SIZE: 1, SCORE_THRESHOLD: 62, DAILY_APPROVAL_N: 1 }[key])
      },
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' },
        listByStatus: () => [opportunity],
        claim: (...args) => events.push(['claim', ...args]) || true,
        releaseClaim: (...args) => events.push(['release', ...args]),
        updateRow: (...args) => events.push(['update', ...args]),
      },
      Logger: { log: () => {} }
    },
    names: ['Match']
  }).Match;

  const result = Match.scoreQueue(1);
  assert.equal(result.scored, 0);
  assert.equal(result.queued, 0);
  const update = events.find((event) => event[0] === 'update');
  assert.equal(update[3].status, 'sourced');
  assert.match(update[3].failure_message, /temporary Gemini failure/);
  assert.deepEqual(events.map((event) => event[0]), ['claim', 'update', 'release']);
});

test('pruneDeadLinks uses the configured maintenance-check maximum', () => {
  let checks = 0;
  const diagnostics = loadGs(resolve(ROOT, 'src/Diagnostics.gs'), {
    globals: {
      Config: { tunable: (key) => key === 'MAINTENANCE_CHECKS' ? 2 : undefined },
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' },
        ensureSchema: () => {},
        readAll: (tab) => tab === 'Opportunities'
          ? [
            { _row: 2, id: 'opp-1', url: 'https://example.test/1', status: 'sourced' },
            { _row: 3, id: 'opp-2', url: 'https://example.test/2', status: 'sourced' },
            { _row: 4, id: 'opp-3', url: 'https://example.test/3', status: 'sourced' }
          ]
          : [],
        updateRow: () => {}
      },
      Sources: { linkAlive_: () => { checks++; return true; } },
      Logger: { log: () => {} },
      Alerts: { notify: () => {} }
    },
    names: ['pruneDeadLinks']
  }).pruneDeadLinks;

  const report = diagnostics();
  assert.equal(checks, 2);
  assert.match(report, /CAPPED \(hit the 2-check or time budget\)/);
});

test('Runtime.withScriptLock releases the script lock even when work fails', () => {
  const calls = [];
  const Runtime = loadGs(resolve(ROOT, 'src/Runtime.gs'), {
    services: {
      LockService: {
        getScriptLock: () => ({
          tryLock: (waitMs) => calls.push(['tryLock', waitMs]) || true,
          releaseLock: () => calls.push(['releaseLock'])
        })
      }
    },
    names: ['Runtime']
  }).Runtime;

  assert.throws(() => Runtime.withScriptLock('scoreQueue', 250, () => {
    throw new Error('work failed');
  }), /work failed/);
  assert.deepEqual(calls, [['tryLock', 250], ['releaseLock']]);
});

test('Runtime refuses a lock it cannot acquire and does not run the callback', () => {
  let ran = false;
  const Runtime = loadGs(resolve(ROOT, 'src/Runtime.gs'), {
    services: {
      LockService: {
        getScriptLock: () => ({ tryLock: () => false, releaseLock: () => { throw new Error('must not release'); } })
      }
    },
    names: ['Runtime']
  }).Runtime;

  assert.throws(() => Runtime.withScriptLock('scoreQueue', 50, () => { ran = true; }), /lock/i);
  assert.equal(ran, false);
});

test('Runtime bounds batch values and stops once the deadline is reached', () => {
  const Runtime = loadGs(resolve(ROOT, 'src/Runtime.gs'), { names: ['Runtime'] }).Runtime;
  assert.equal(Runtime.boundedBatch('12', 5, 10), 10);
  assert.equal(Runtime.boundedBatch('0', 5, 10), 5);
  assert.equal(Runtime.boundedBatch('nope', 5, 10), 5);
  assert.equal(Runtime.shouldStop(Date.now() - 1), true);
  assert.equal(Runtime.shouldStop(Date.now() + 10000), false);
  assert.ok(Runtime.deadlineMs(100) > Date.now());
});

test('Runtime.failure gives a bounded trigger-safe failure record', () => {
  const Runtime = loadGs(resolve(ROOT, 'src/Runtime.gs'), { names: ['Runtime'] }).Runtime;
  const failure = Runtime.failure('opportunity:job-1', new Error('bad response\nsecret=do-not-log'));
  assert.equal(failure.name, 'opportunity:job-1');
  assert.equal(failure.message, 'bad response secret=do-not-log');
  assert.ok(failure.message.length <= 240);
});

test('Crm headers include processing and artefact fields while old rows remain claimable', () => {
  const { Crm } = loadGs(resolve(ROOT, 'src/Crm.gs'), { names: ['Crm'] });
  for (const field of [
    'processing_state', 'processing_key', 'processing_started_at',
    'cv_file_id', 'cover_file_id', 'draft_id', 'failure_message'
  ]) assert.ok(Crm.HEADERS.Opportunities.includes(field), field);
  for (const field of ['processing_state', 'processing_key', 'processing_started_at', 'failure_message']) {
    assert.ok(Crm.HEADERS.Approvals.includes(field), `Approvals.${field}`);
    assert.ok(Crm.HEADERS.Contacts.includes(field), `Contacts.${field}`);
  }
});

test('Crm claims stable IDs, refuses active duplicates, and reclaims expired claims', () => {
  const updates = [];
  const rows = [{ _row: 27, id: 'opp-stable', processing_state: 'working', processing_key: 'opp-stable',
    processing_started_at: new Date(Date.now() - 1000) }];
  const { Crm } = loadGs(resolve(ROOT, 'src/Crm.gs'), { names: ['Crm'] });
  Crm.readAll = () => rows;
  Crm.updateRow = (...args) => updates.push(args);
  Crm.Runtime = { withScriptLock: (_name, _waitMs, fn) => fn() };

  assert.equal(Crm.claim('Opportunities', 'opp-stable', { leaseMs: 60000 }), false);
  const firstToken = Crm.claim('Opportunities', 'opp-stable', { leaseMs: 500 });
  assert.equal(typeof firstToken, 'string');
  assert.ok(firstToken.length > 0);
  assert.equal(updates[0][1], 27);
  assert.equal(updates[0][2].processing_key, firstToken);
  assert.equal(updates[0][2].processing_state, 'working');

  rows[0].processing_started_at = new Date(Date.now() - 5000);
  const secondToken = Crm.claim('Opportunities', 'opp-stable', { leaseMs: 1000 });
  assert.equal(typeof secondToken, 'string');
  assert.notEqual(secondToken, firstToken);
});

test('Crm releaseClaim requires the current claim token and cannot clear a reclaimed claim', () => {
  const updates = [];
  const rows = [{ _row: 44, id: 'contact-stable', processing_state: 'working', processing_key: 'claim-b' }];
  const { Crm } = loadGs(resolve(ROOT, 'src/Crm.gs'), { names: ['Crm'] });
  Crm.readAll = () => rows;
  Crm.updateRow = (...args) => updates.push(args);
  Crm.Runtime = { withScriptLock: (_name, _waitMs, fn) => fn() };

  assert.equal(Crm.releaseClaim('Contacts', 'contact-stable', 'claim-a'), false);
  assert.equal(updates.length, 0);
  assert.equal(Crm.releaseClaim('Contacts', 'contact-stable', 'claim-b'), true);
  assert.equal(updates[0][1], 44);
  assert.equal(updates[0][2].processing_state, '');
  assert.equal(updates[0][2].processing_key, '');
  assert.equal(updates[0][2].processing_started_at, '');
});

test('Crm upsertApproval reuses the stable opportunity row and verifies persistence', () => {
  const updates = [];
  const appRow = {
    _row: 9, id: 'opp-approval', company: 'Old Co', role: 'Old Role', fit_score: 70,
    decision: 'Approve', edited_notes: 'Keep this human note'
  };
  const rows = [appRow];
  const { Crm } = loadGs(resolve(ROOT, 'src/Crm.gs'), { names: ['Crm'] });
  Crm.readAll = () => rows;
  Crm.updateRow = (tab, row, obj) => {
    updates.push([tab, row, obj]);
    Object.assign(appRow, obj);
  };
  Crm.appendRow = () => { throw new Error('duplicate approval row'); };
  Crm.Runtime = { withScriptLock: (name, waitMs, fn) => fn() };

  const result = Crm.upsertApproval({
    id: 'opp-approval', company: 'New Co', role: 'New Role', fit_score: 92,
    track: 'support', rationale: 'Strong fit'
  });
  assert.equal(result.id, 'opp-approval');
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], 9);
  assert.equal(appRow.decision, 'Approve');
  assert.equal(appRow.edited_notes, 'Keep this human note');
});

test('Tailor reuses a stored CV and cover artefact without calling Gemini or creating files', () => {
  const updates = [];
  let geminiCalls = 0;
  let copyCalls = 0;
  const files = {
    'cv-existing': { getId: () => 'cv-existing', getUrl: () => 'https://drive.test/cv-existing' },
    'cover-existing': { getId: () => 'cover-existing', getUrl: () => 'https://drive.test/cover-existing' }
  };
  const { Tailor } = loadGs(resolve(ROOT, 'src/Tailor.gs'), {
    globals: {
      Config: { KEYS: { MASTER_CV_DOC_ID: 'MASTER_CV_DOC_ID' }, require: () => 'config', promptCandidate: () => ({ firstName: 'A', name: 'A' }) },
      Gemini: { generate: () => { geminiCalls++; throw new Error('must not regenerate'); } },
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities' }, updateRow: (...args) => updates.push(args) },
      DriveApp: {
        getFileById: (id) => files[id] || (() => { copyCalls++; throw new Error('unexpected file lookup'); })()
      }
    },
    names: ['Tailor']
  });
  const opp = { _row: 2, id: 'opp-1', company: 'Example', role: 'Support', cv_file_id: 'cv-existing', cover_file_id: 'cover-existing' };
  assert.equal(Tailor.operationKey_(opp, 'cv'), 'opp-1:cv');
  assert.equal(Tailor.operationKey_(opp, 'cover'), 'opp-1:cover');
  assert.equal(Tailor.tailorCv(opp).pdfId, 'cv-existing');
  assert.equal(Tailor.coverLetter(opp).pdfId, 'cover-existing');
  assert.equal(geminiCalls, 0);
  assert.equal(copyCalls, 0);
  assert.equal(updates.length, 0);
});

test('Tailor persists a CV ID immediately so a later failure cannot create a second CV', () => {
  const updates = [];
  const copy = { getId: () => 'cv-doc', getUrl: () => 'https://drive.test/cv-doc' };
  const pdf = { getId: () => 'cv-pdf', getUrl: () => 'https://drive.test/cv-pdf' };
  const { Tailor } = loadGs(resolve(ROOT, 'src/Tailor.gs'), {
    globals: {
      Config: { KEYS: { MASTER_CV_DOC_ID: 'MASTER_CV_DOC_ID', DRIVE_FOLDER_ID: 'DRIVE_FOLDER_ID' }, require: (key) => key === 'MASTER_CV_DOC_ID' ? 'master' : 'folder', promptCandidate: () => ({ firstName: 'A', name: 'A' }) },
      Gemini: { generate: () => 'summary' },
      Prompts: { render: () => 'prompt' },
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities' }, updateRow: (...args) => updates.push(args) },
      DriveApp: {
        getFileById: (id) => id === 'master' ? { makeCopy: () => copy } : ({ getAs: () => ({}) }),
      },
      DocumentApp: { openById: () => ({ getBody: () => ({ replaceText: () => {} }), saveAndClose: () => {} }) },
      folder: null
    },
    names: ['Tailor']
  });
  Tailor.folderForOpp_ = () => ({ createFile: () => ({ ...pdf, setName: () => pdf }) });
  const result = Tailor.tailorCv({ _row: 4, id: 'opp-2', company: 'Example', role: 'Support' });
  assert.equal(result.pdfId, 'cv-pdf');
  assert.equal(updates.some((entry) => entry[2].cv_file_id === 'cv-pdf'), true);
});

test('Outreach validates contact email, reuses stored drafts, and remains draft-only', () => {
  let createCalls = 0;
  const updates = [];
  const { Outreach } = loadGs(resolve(ROOT, 'src/Outreach.gs'), {
    globals: {
      Config: { promptCandidate: () => ({ name: 'A' }) },
      Validation: { isEmail: (value) => value === 'person@example.test' },
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => 'body' },
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities' }, updateRow: (...args) => updates.push(args) },
      GmailApp: {
        getDraft: (id) => ({ getId: () => id }),
        createDraft: () => { createCalls++; return { getId: () => 'new-draft' }; }
      }
    },
    names: ['Outreach']
  });
  assert.equal(Outreach.draftFor({ id: 'opp-3', contact_email: 'person@example.test', draft_id: 'old-draft', role: 'Support' }, {}), 'old-draft');
  assert.throws(() => Outreach.draftFor({ id: 'opp-4', contact_email: 'bad address', role: 'Support' }, {}), /email/i);
  assert.equal(createCalls, 0);
  assert.equal(updates.length, 0);
});

test('Outreach reuses a deterministic application draft when the CRM draft ID was not persisted', () => {
  let creates = 0;
  const { Outreach } = loadGs(resolve(ROOT, 'src/Outreach.gs'), {
    globals: {
      Config: { promptCandidate: () => ({ name: 'A' }) },
      Validation: { isEmail: () => true },
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => { throw new Error('must not regenerate'); } },
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities' }, updateRow: () => { throw new Error('must not write'); } },
      GmailApp: {
        getDraft: () => null,
        getDrafts: () => [{ getMessage: () => ({ getSubject: () => '[JHA:opp-8:application] Application' }), getId: () => 'existing-draft' }],
        createDraft: () => { creates++; return { getId: () => 'new-draft' }; }
      }
    },
    names: ['Outreach']
  });
  assert.equal(Outreach.draftFor({ id: 'opp-8', contact_email: 'person@example.test', role: 'Support' }, {}), 'existing-draft');
  assert.equal(creates, 0);
});

test('Outreach writes follow-up markers only after draft creation and reuses the marker on retry', () => {
  const updates = [];
  let creates = 0;
  const row = { _row: 8, id: 'opp-5', contact_email: 'person@example.test', role: 'Support', notes: '' };
  const { Outreach } = loadGs(resolve(ROOT, 'src/Outreach.gs'), {
    globals: {
      Config: { promptCandidate: () => ({ name: 'A' }) },
      Validation: { isEmail: () => true },
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => 'body' },
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities' }, updateRow: (_tab, _row, values) => { Object.assign(row, values); updates.push(values); } },
      GmailApp: {
        getDraft: () => null,
        getDrafts: () => [],
        createDraft: () => { creates++; return { getId: () => 'followup-draft' }; }
      }
    },
    names: ['Outreach']
  });
  assert.equal(Outreach.draftFollowUp(row, 'a few days'), 'followup-draft');
  assert.match(row.notes, /\[fu3\]/);
  assert.equal(Outreach.draftFollowUp(row, 'a few days'), null);
  assert.equal(creates, 1);
  assert.equal(updates.length, 1);
});

test('InterviewPrep reuses the stored interview operation marker', () => {
  let creates = 0;
  const { InterviewPrep } = loadGs(resolve(ROOT, 'src/InterviewPrep.gs'), {
    globals: {
      Tailor: { folderForOpp_: () => ({}), safe_: (value) => value },
      Config: { promptCandidate: () => ({ firstName: 'A' }) },
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => { throw new Error('must not regenerate'); } },
      DocumentApp: { create: () => { creates++; throw new Error('must not create'); } }
    },
    names: ['InterviewPrep']
  });
  const result = InterviewPrep.generateFor({ id: 'opp-6', notes: '[interview:opp-6:interview:doc-6:https://drive.test/doc-6]' });
  assert.equal(result.docId, 'doc-6');
  assert.equal(result.docUrl, 'https://drive.test/doc-6');
  assert.equal(creates, 0);
});

test('prepInterviews skips legacy prepped markers instead of generating a second document', () => {
  let creates = 0;
  const { prepInterviews } = loadGs(resolve(ROOT, 'src/Loop.gs'), {
    globals: {
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities' },
        ensureSchema: () => {},
        readAll: () => [{ _row: 2, id: 'opp-9', status: 'interview', notes: '[prepped] https://drive.test/old' }]
      },
      Config: { tunable: () => 1 },
      Runtime: { withScriptLock: (_name, _wait, fn) => fn(), boundedBatch: (value) => value, deadlineMs: () => Date.now() + 10000, shouldStop: () => false, failure: () => ({}) },
      InterviewPrep: { generateFor: () => { creates++; throw new Error('must not generate'); } },
      Logger: { log: () => {} },
      Alerts: { notify: () => {} }
    },
    names: ['prepInterviews']
  });
  assert.equal(prepInterviews(), 0);
  assert.equal(creates, 0);
});

test('Loop trigger workers enforce a deadline, cap work, and alert one aggregate failure', () => {
  const alerts = [];
  const failures = [];
  const Loop = loadGs(resolve(ROOT, 'src/Loop.gs'), {
    globals: {
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities' },
        ensureSchema: () => {},
        readAll: () => [{ _row: 2, id: 'opp-7', status: 'sent', contact_email: 'person@example.test', response: '', applied_date: new Date(Date.now() - 4 * 86400000), notes: '' }],
      },
      Config: { tunable: () => 1, defaults: { FOLLOWUP_DAYS: [3, 7] } },
      Runtime: { withScriptLock: (_name, _wait, fn) => fn(), boundedBatch: (value) => value, deadlineMs: () => 0, shouldStop: () => false, failure: (name, error) => ({ name, message: String(error) }) },
      Outreach: { draftFollowUp: () => { throw new Error('follow-up failed'); } },
      Alerts: { notify: (...args) => alerts.push(args) },
      Logger: { log: () => {} }
    },
    names: ['followUps']
  }).followUps;
  assert.throws(() => Loop(), /follow-up failed/);
  assert.equal(alerts.length, 1);
  assert.match(String(alerts[0][1]), /follow-up failed/);
});

test('followUps claims each opportunity and releases its token after drafting', () => {
  const events = [];
  const { followUps } = loadGs(resolve(ROOT, 'src/Loop.gs'), {
    globals: {
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities' }, ensureSchema: () => {},
        readAll: () => [{ _row: 2, id: 'opp-follow', status: 'sent', contact_email: 'person@example.test', response: '', applied_date: new Date(Date.now() - 4 * 86400000), notes: '' }],
        claim: (...args) => { events.push(['claim', ...args]); return 'follow-token'; },
        releaseClaim: (...args) => events.push(['release', ...args])
      },
      Config: { tunable: () => 1, defaults: { FOLLOWUP_DAYS: [3, 7] } },
      Runtime: { withScriptLock: (_name, _wait, fn) => fn(), boundedBatch: (value) => value, deadlineMs: () => Date.now() + 10000, shouldStop: () => false, failure: (name, error) => ({ name, message: String(error) }) },
      Outreach: { draftFollowUp: (...args) => { events.push(['draft', ...args]); return 'draft-1'; } },
      Alerts: { notify: () => {} }, Logger: { log: () => {} }
    }, names: ['followUps']
  });
  assert.equal(followUps(), 1);
  assert.deepEqual(events.map((event) => event[0]), ['claim', 'draft', 'release']);
  assert.equal(events[0][2], 'opp-follow');
  assert.equal(events[2][3], 'follow-token');
});

test('prepInterviews claims each opportunity and releases its token after generation', () => {
  const events = [];
  const { prepInterviews } = loadGs(resolve(ROOT, 'src/Loop.gs'), {
    globals: {
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities' }, ensureSchema: () => {},
        readAll: () => [{ _row: 2, id: 'opp-interview', status: 'interview', notes: '' }],
        claim: (...args) => { events.push(['claim', ...args]); return 'interview-token'; },
        releaseClaim: (...args) => events.push(['release', ...args])
      },
      Config: { tunable: () => 1 },
      Runtime: { withScriptLock: (_name, _wait, fn) => fn(), boundedBatch: (value) => value, deadlineMs: () => Date.now() + 10000, shouldStop: () => false, failure: (name, error) => ({ name, message: String(error) }) },
      InterviewPrep: { generateFor: (...args) => { events.push(['generate', ...args]); return { docId: 'doc-1' }; } },
      Alerts: { notify: () => {} }, Logger: { log: () => {} }
    }, names: ['prepInterviews']
  });
  assert.equal(prepInterviews(), 1);
  assert.deepEqual(events.map((event) => event[0]), ['claim', 'generate', 'release']);
  assert.equal(events[2][3], 'interview-token');
});

test('agency outreach claims each contact and releases its token after draft persistence', () => {
  const events = [];
  const { Outreach } = loadGs(resolve(ROOT, 'src/Outreach.gs'), {
    globals: {
      Config: { tunable: () => 1, promptCandidate: () => ({ name: 'A' }) },
      Validation: { isEmail: () => true }, Prompts: { render: () => 'prompt' }, Gemini: { generate: () => 'body' },
      Crm: {
        TABS: { CONTACTS: 'Contacts' },
        readAll: () => [{ _row: 2, id: 'contact-agency', type: 'agency', email: 'agency@example.test', name: 'Agency' }],
        claim: (...args) => { events.push(['claim', ...args]); return 'agency-token'; },
        releaseClaim: (...args) => events.push(['release', ...args]),
        updateRow: (...args) => events.push(['update', ...args])
      },
      Runtime: { boundedBatch: (value) => value, shouldStop: () => false, failure: (name, error) => ({ name, message: String(error) }) },
      GmailApp: { getDraft: () => null, getDrafts: () => [], createDraft: () => ({ getId: () => 'agency-draft' }) }
    }, names: ['Outreach']
  });
  const result = Outreach.draftAgencyOutreach(1, Date.now() + 10000);
  assert.equal(result.created, 1);
  assert.deepEqual(events.map((event) => event[0]), ['claim', 'update', 'release']);
  assert.equal(events[0][2], 'contact-agency');
  assert.equal(events[2][3], 'agency-token');
});

test('agency outreach does not claim a contact without a stable contact ID', () => {
  const events = [];
  const { Outreach } = loadGs(resolve(ROOT, 'src/Outreach.gs'), {
    globals: {
      Config: { tunable: () => 1, promptCandidate: () => ({ name: 'A' }) },
      Validation: { isEmail: () => true },
      Crm: {
        TABS: { CONTACTS: 'Contacts' },
        readAll: () => [{ _row: 7, type: 'agency', email: 'agency@example.test', name: 'Agency' }],
        claim: (...args) => { events.push(['claim', ...args]); return 'wrong-token'; },
        updateRow: (...args) => events.push(['update', ...args])
      },
      Runtime: { boundedBatch: (value) => value, shouldStop: () => false, failure: (name, error) => ({ name, message: String(error) }) },
      GmailApp: { getDraft: () => null, getDrafts: () => [], createDraft: () => ({ getId: () => 'agency-draft' }) }
    }, names: ['Outreach']
  });
  const result = Outreach.draftAgencyOutreach(1, Date.now() + 10000);
  assert.equal(result.created, 0);
  assert.equal(events.some((event) => event[0] === 'claim'), false);
});

test('Alerts sanitises secrets, URLs, and oversized response bodies without recursing on delivery failure', () => {
  const sent = [];
  const logs = [];
  const Alerts = loadGs(resolve(ROOT, 'src/Alerts.gs'), {
    globals: {
      Config: { get: () => 'alerts@example.test', defaults: { ALERT_EMAIL: 'alerts@example.test' } },
      MailApp: { sendEmail: (message) => { sent.push(message); throw new Error('mailer failed with https://mail.example.test/token=secret'); } },
      Logger: { log: (message) => logs.push(String(message)) }
    },
    names: ['Alerts']
  }).Alerts;

  Alerts.notify('dailySource', new Error('HTTP 403 API key: secret https://api.example.test/path?key=secret body=' + 'x'.repeat(5000)));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.includes('secret'), false);
  assert.equal(sent[0].body.includes('https://api.example.test'), false);
  assert.ok(sent[0].body.length <= 1200);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes('secret'), false);
  assert.equal(logs[0].includes('https://mail.example.test'), false);
});

test('dailySource uses the shared lock and alerts before rethrowing trigger failures', () => {
  const events = [];
  const { dailySource } = loadGs(resolve(ROOT, 'src/Loop.gs'), {
    globals: {
      Runtime: { withScriptLock: (name, wait, fn) => { events.push(['lock', name, wait]); return fn(); } },
      Crm: { ensureSchema: () => events.push(['schema']) },
      Config: { tunable: () => 10 },
      Sources: { ingest: () => { throw new Error('source failed'); } },
      Alerts: { notify: (...args) => events.push(['alert', ...args]) },
      Logger: { log: () => {} }
    },
    names: ['dailySource']
  });

  assert.throws(() => dailySource(), /source failed/);
  assert.deepEqual(events.map((event) => event[0]), ['lock', 'schema', 'alert']);
  assert.equal(events[0][1], 'dailySource');
});

test('per-item follow-up and interview failures persist retryable CRM state before aggregate alert', () => {
  const updates = [];
  const alerts = [];
  const base = {
    TABS: { OPPORTUNITIES: 'Opportunities' },
    ensureSchema: () => {},
    readAll: () => [{ _row: 2, id: 'opp-fail', status: 'sent', contact_email: 'person@example.test', response: '', applied_date: new Date(Date.now() - 4 * 86400000), notes: '' }],
    claim: () => 'token',
    releaseClaim: () => {},
    recordOpportunityFailure: (row, message) => updates.push([row, message])
  };
  const { followUps } = loadGs(resolve(ROOT, 'src/Loop.gs'), {
    globals: {
      Crm: base,
      Config: { tunable: () => 1, defaults: { FOLLOWUP_DAYS: [3, 7] } },
      Runtime: { withScriptLock: (_n, _w, fn) => fn(), boundedBatch: (v) => v, deadlineMs: () => Date.now() + 10000, shouldStop: () => false, failure: (_n, e) => ({ name: 'item', message: e.message }) },
      Outreach: { draftFollowUp: () => { throw new Error('retry follow-up'); } },
      Alerts: { notify: (...args) => alerts.push(args) }, Logger: { log: () => {} }
    }, names: ['followUps']
  });
  assert.throws(() => followUps(), /retry follow-up/);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 2);
  assert.equal(alerts.length, 1);
});

test('onSheetEdit reports actionable failures to Alerts and rethrows them', () => {
  const alerts = [];
  const { onSheetEdit } = loadGs(resolve(ROOT, 'src/SheetUi.gs'), {
    globals: {
      SETUP_TAB: 'Setup',
      Crm: { TABS: { OPPORTUNITIES: 'Opportunities' }, colIndex: () => { throw new Error('sheet unavailable'); } },
      Alerts: { notify: (...args) => alerts.push(args) },
      Logger: { log: () => {} }
    }, names: ['onSheetEdit']
  });
  const sheet = { getName: () => 'Opportunities' };
  const range = { getSheet: () => sheet, getNumRows: () => 1, getNumColumns: () => 1, getColumn: () => 2, getRow: () => 2 };
  assert.throws(() => onSheetEdit({ range, value: 'sent' }), /sheet unavailable/);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], 'onSheetEdit');
});

test('diagnose reports an entry-point failure to Alerts before rethrowing', () => {
  const alerts = [];
  const { diagnose } = loadGs(resolve(ROOT, 'src/Diagnostics.gs'), {
    globals: {
      PropertiesService: { getScriptProperties: () => { throw new Error('properties unavailable'); } },
      Alerts: { notify: (...args) => alerts.push(args) },
      Logger: { log: () => {} }
    }, names: ['diagnose']
  });
  assert.throws(() => diagnose(), /properties unavailable/);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], 'diagnose');
});

test('pruneDeadLinks runs behind the shared lock and alerts on failure', () => {
  const events = [];
  const { pruneDeadLinks } = loadGs(resolve(ROOT, 'src/Diagnostics.gs'), {
    globals: {
      Runtime: { withScriptLock: (name, wait, fn) => { events.push(['lock', name, wait]); return fn(); } },
      Crm: { ensureSchema: () => { throw new Error('maintenance unavailable'); } },
      Alerts: { notify: (...args) => events.push(['alert', ...args]) },
      Logger: { log: () => {} }
    }, names: ['pruneDeadLinks']
  });
  assert.throws(() => pruneDeadLinks(), /maintenance unavailable/);
  assert.deepEqual(events.map((event) => event[0]), ['lock', 'alert']);
});

test('morningDigest uses the shared lock while retaining its existing no-pending fast path', () => {
  const events = [];
  const { morningDigest } = loadGs(resolve(ROOT, 'src/Digest.gs'), {
    globals: {
      Runtime: { withScriptLock: (name, wait, fn) => { events.push(['lock', name, wait]); return fn(); } },
      Crm: { ensureSchema: () => {}, TABS: { APPROVALS: 'Approvals' }, readAll: () => [] },
      Logger: { log: (message) => events.push(['log', message]) }, Alerts: { notify: () => {} }
    }, names: ['morningDigest']
  });
  morningDigest();
  assert.equal(events[0][0], 'lock');
  assert.equal(events[0][1], 'morningDigest');
});
