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
      let claimed = false;
      let claimToken = '';
      try {
        const claimResult = Crm.claim ? Crm.claim(Crm.TABS.OPPORTUNITIES, opp.id) : true;
        claimed = claimResult !== false;
        claimToken = typeof claimResult === 'string' ? claimResult : '';
        if (!claimed) return;
        const r = self.scoreOne(opp);
        const pass = Number(r.fit_score) >= threshold;
        if (pass && queued >= approvalLimit) return;
        const canQueue = pass && queued < approvalLimit;
        if (canQueue) {
          const approvalPayload = self.approval_(opp, r);
          Crm.upsertApproval(approvalPayload);
          const verified = Crm.findApproval(opp.id);
          if (!verified || String(verified.id || '').trim() !== String(opp.id || '').trim()) {
            throw new Error('Approval row verification failed for ' + opp.id);
          }
        }
        Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
          fit_score: r.fit_score, track: r.track, rationale: r.rationale,
          status: canQueue ? 'queued_for_approval' : 'scored', failure_message: '', updated_at: new Date()
        });
        scored++;
        if (canQueue) queued++;
      } catch (e) {
        Logger.log('score ' + opp.id + ': ' + e);
        const message = self.failureMessage_(e);
        if (Crm.recordOpportunityFailure) {
          Crm.recordOpportunityFailure(opp._row, message);
        } else if (!e || !e.scoreValidation) {
          Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
            status: 'sourced', failure_message: message, updated_at: new Date()
          });
        }
      } finally {
        if (claimed && Crm.releaseClaim) {
          try { Crm.releaseClaim(Crm.TABS.OPPORTUNITIES, opp.id, claimToken); } catch (releaseError) {
            Logger.log('release score claim ' + opp.id + ': ' + releaseError);
          }
        }
      }
    });
    return { scored: scored, queued: queued };
  },

  approval_(opp, r) {
    return {
      id: opp.id, company: opp.company, role: opp.role, url: opp.url,
      fit_score: r.fit_score, track: r.track, rationale: r.rationale,
      channel: opp.contact_email ? 'email' : 'portal'
    };
  },

  failureMessage_(error) {
    if (typeof Runtime !== 'undefined' && Runtime.failure) {
      return Runtime.failure('opportunity', error).message;
    }
    let message = '';
    try { message = String(error && error.message ? error.message : error || 'Unknown failure'); } catch (e) { message = 'Unknown failure'; }
    return message.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  },

};
