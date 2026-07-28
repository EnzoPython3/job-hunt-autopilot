/**
 * Match.gs - Gemini-powered fit scoring, and routing to the Approvals queue.
 */
const Match = {
  SCHEMA: {
    type: 'object',
    properties: {
      fit_score: { type: 'integer' },
      track: { type: 'string' },
      rationale: { type: 'string' },
      matched_keywords: { type: 'array', items: { type: 'string' } },
      missing_keywords: { type: 'array', items: { type: 'string' } }
    },
    required: ['fit_score', 'track', 'rationale']
  },

  scoreOne(opp) {
    const prompt = Prompts.render('scoring', {
      candidate: JSON.stringify(Config.promptCandidate()),
      job: JSON.stringify({ company: opp.company, role: opp.role, location: opp.location, mode: opp.mode, url: opp.url })
    });
    return this.validateScore_(Gemini.generate(prompt, {
      json: true, schema: this.SCHEMA, temperature: 0.2, maxOutputTokens: 700
    }));
  },

  validateScore_(result) {
    const invalid = function (message) {
      const error = new Error('Invalid Gemini score: ' + message);
      error.scoreValidation = true;
      throw error;
    };
    if (!result || typeof result !== 'object' || Array.isArray(result)) invalid('object required');
    if (typeof result.fit_score !== 'number' || !isFinite(result.fit_score) ||
        Math.floor(result.fit_score) !== result.fit_score || result.fit_score < 0 || result.fit_score > 100) {
      invalid('fit_score must be an integer from 0 to 100');
    }
    if (typeof result.track !== 'string' || !result.track.trim()) invalid('track is required');
    if (typeof result.rationale !== 'string' || !result.rationale.trim()) invalid('rationale is required');
    ['matched_keywords', 'missing_keywords'].forEach(function (key) {
      if (result[key] !== undefined && (!Array.isArray(result[key]) || result[key].some(function (item) {
        return typeof item !== 'string';
      }))) invalid(key + ' must be an array of strings');
    });
    return result;
  },

  scoreQueue(chunk) {
    chunk = chunk || Config.tunable('CHUNK_SIZE');
    const threshold = Number(Config.tunable('SCORE_THRESHOLD'));
    // DAILY_APPROVAL_N limits new approval rows created by this scoring run.
    // Rows beyond the limit are scored but remain eligible for the next run.
    const approvalLimit = Config.tunable('DAILY_APPROVAL_N');
    const pending = Crm.listByStatus('sourced').slice(0, chunk);
    const self = this;
    let scored = 0, queued = 0;
    pending.forEach(function (opp) {
      try {
        const r = self.scoreOne(opp);
        const pass = Number(r.fit_score) >= threshold;
        if (pass && queued >= approvalLimit) return;
        const canQueue = pass && queued < approvalLimit;
        const status = canQueue ? 'queued_for_approval' : 'scored';
        Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
          fit_score: r.fit_score, track: r.track, rationale: r.rationale,
          status: status, updated_at: new Date()
        });
        scored++;
        if (canQueue) { self.pushToApprovals_(opp, r); queued++; }
      } catch (e) {
        Logger.log('score ' + opp.id + ': ' + e);
        if (!e || !e.scoreValidation) {
          Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
            status: 'scored', rationale: 'score error: ' + e, updated_at: new Date()
          });
        }
      }
    });
    return { scored: scored, queued: queued };
  },

  pushToApprovals_(opp, r) {
    Crm.appendRow(Crm.TABS.APPROVALS, {
      id: opp.id, company: opp.company, role: opp.role, url: opp.url,
      fit_score: r.fit_score, track: r.track, rationale: r.rationale,
      channel: opp.contact_email ? 'email' : 'portal', decision: '', edited_notes: ''
    });
  }
};
