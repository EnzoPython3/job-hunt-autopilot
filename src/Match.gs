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
    return Gemini.generate(prompt, { json: true, schema: this.SCHEMA, temperature: 0.2, maxOutputTokens: 700 });
  },

  scoreQueue(chunk) {
    chunk = chunk || Config.tunable('CHUNK_SIZE');
    const threshold = Number(Config.tunable('SCORE_THRESHOLD'));
    const pending = Crm.listByStatus('sourced').slice(0, chunk);
    const self = this;
    let scored = 0, queued = 0;
    pending.forEach(function (opp) {
      try {
        const r = self.scoreOne(opp);
        const pass = Number(r.fit_score) >= threshold;
        const status = pass ? 'queued_for_approval' : 'scored';
        Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
          fit_score: r.fit_score, track: r.track, rationale: r.rationale,
          status: status, updated_at: new Date()
        });
        scored++;
        if (pass) { self.pushToApprovals_(opp, r); queued++; }
      } catch (e) {
        Logger.log('score ' + opp.id + ': ' + e);
        Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
          status: 'scored', rationale: 'score error: ' + e, updated_at: new Date()
        });
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
