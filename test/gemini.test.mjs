import { strict as assert } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadGs } from './helpers/load-gs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function response(code, body) {
  return {
    getResponseCode: () => code,
    getContentText: () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function loadGemini(fetch, validation = {}) {
  return loadGs(resolve(ROOT, 'src/Gemini.gs'), {
    services: {
      Config: {
        KEYS: { GEMINI_API_KEY: 'GEMINI_API_KEY', GEMINI_MODEL: 'GEMINI_MODEL' },
        require: () => 'test-secret-key',
        get: (key) => key === 'GEMINI_MODEL' ? 'gemini-test-model' : null,
        defaults: { GEMINI_MODEL: 'gemini-flash-latest' }
      },
      UrlFetchApp: { fetch },
      Utilities: { sleep: () => {} },
      Validation: {
        validateGeminiTextResponse: validation.validateGeminiTextResponse || ((json) => json.candidates[0].content.parts[0].text)
      }
    },
    names: ['Gemini']
  }).Gemini;
}

const validEnvelope = { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };

test('Gemini authenticates with x-goog-api-key and keeps the key out of the URL', () => {
  const calls = [];
  const Gemini = loadGemini((url, options) => {
    calls.push({ url, options });
    return response(200, validEnvelope);
  });

  assert.equal(Gemini.generate('hello'), 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-secret-key');
  assert.equal(calls[0].url.includes('test-secret-key'), false);
  assert.equal(calls[0].url.includes('?key='), false);
});

test('Gemini retries one unsupported-thinkingConfig 400 without thinkingConfig', () => {
  const payloads = [];
  const Gemini = loadGemini((url, options) => {
    payloads.push(JSON.parse(options.payload));
    return payloads.length === 1
      ? response(400, { error: { status: 'INVALID_ARGUMENT', message: 'Field thinkingConfig is not supported' } })
      : response(200, validEnvelope);
  });

  assert.equal(Gemini.generate('hello'), 'ok');
  assert.ok(payloads[0].generationConfig.thinkingConfig);
  assert.equal(payloads[1].generationConfig.thinkingConfig, undefined);
});

test('Gemini does not retry unrelated 400 responses', () => {
  for (const body of [
    { error: { status: 'UNAUTHENTICATED', message: 'API key not valid' } },
    { error: { status: 'NOT_FOUND', message: 'Model not found' } },
    { error: { status: 'INVALID_ARGUMENT', message: 'responseSchema is invalid' } },
    { error: { status: 'INVALID_ARGUMENT', message: 'Malformed request' } },
    { error: { status: 'INVALID_ARGUMENT', message: 'thinkingConfig has an invalid value' } }
  ]) {
    let calls = 0;
    const Gemini = loadGemini(() => {
      calls++;
      return response(400, body);
    });

    assert.throws(() => Gemini.generate('hello'), /Gemini request failed: HTTP 400/);
    assert.equal(calls, 1, JSON.stringify(body));
  }
});

test('Gemini retries 429 and 5xx only through the finite configured count', () => {
  for (const code of [429, 500, 503]) {
    let calls = 0;
    const Gemini = loadGemini(() => {
      calls++;
      return response(code, { error: { status: 'UNAVAILABLE', message: 'temporary failure' } });
    });
    Gemini.RETRY_COUNT = 2;

    assert.throws(() => Gemini.generate('hello'), /Gemini request failed: HTTP/);
    assert.equal(calls, 3, String(code));
  }
});

test('successful Gemini envelopes with no usable text fail through Validation.validateGeminiTextResponse', () => {
  const failures = [
    {},
    { candidates: [] },
    { candidates: [{ content: { parts: [] } }] },
    { candidates: [{ content: { parts: [{ inlineData: {} }] } }] }
  ];
  for (const envelope of failures) {
    let validations = 0;
    const Gemini = loadGemini(() => response(200, envelope), {
      validateGeminiTextResponse: (json) => {
        validations++;
        throw new Error('validated malformed Gemini response');
      }
    });

    assert.throws(() => Gemini.generate('hello'), /validated malformed Gemini response/);
    assert.equal(validations, 1);
  }
});

function loadMatch(result, updates) {
  return loadGs(resolve(ROOT, 'src/Match.gs'), {
    globals: {
      Prompts: { render: () => 'prompt' },
      Gemini: { generate: () => result },
      Config: {
        promptCandidate: () => ({ name: 'Candidate' }),
        tunable: (key) => key === 'CHUNK_SIZE' ? 1 : 62
      },
      Crm: {
        TABS: { OPPORTUNITIES: 'Opportunities', APPROVALS: 'Approvals' },
        listByStatus: () => [{ _row: 2, id: 'opp-1', company: 'Example', role: 'Support', location: 'Remote', mode: 'remote', url: 'https://example.test/job' }],
        updateRow: (...args) => updates.push(args),
        appendRow: () => { throw new Error('append should not be reached'); }
      },
      Logger: { log: () => {} }
    },
    names: ['Match']
  }).Match;
}

test('Match rejects invalid scoring JSON before writing any CRM update', () => {
  for (const result of [
    { fit_score: -1, track: 'support', rationale: 'reason' },
    { fit_score: 101, track: 'support', rationale: 'reason' },
    { fit_score: 50, rationale: 'reason' },
    { fit_score: 50, track: 'support' },
    { fit_score: '50', track: 'support', rationale: 'reason' },
    { fit_score: 50, track: 7, rationale: 'reason' },
    { fit_score: 50, track: 'support', rationale: null }
  ]) {
    const updates = [];
    const Match = loadMatch(result, updates);
    assert.deepEqual(Match.scoreQueue(1), { scored: 0, queued: 0 });
    assert.equal(updates.length, 0, JSON.stringify(result));
  }
});
