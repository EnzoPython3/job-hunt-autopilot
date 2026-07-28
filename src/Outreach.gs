/**
 * Outreach.gs - Gmail DRAFTS only. Nothing is ever auto-sent.
 * A human reviews each draft in Gmail and clicks send.
 *
 * Two paths:
 *  - draftFor(opp, assets): a personalised application email to a posting's contact.
 *  - draftAgencyOutreach(): intro emails to the curated recruitment-agency list.
 */
const Outreach = {
  operationKey_(opp, operation) {
    const id = String(opp && (opp.id || opp.contact_id) || '').trim();
    if (!id) throw new Error('Stable CRM ID is required for ' + operation);
    return id.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120) + ':' + String(operation || '').replace(/[^A-Za-z0-9._:-]/g, '_');
  },

  draftById_(id) {
    if (!id || typeof GmailApp.getDraft !== 'function') return null;
    try { return GmailApp.getDraft(String(id)); } catch (e) { return null; }
  },

  draftByKey_(key) {
    if (!key || typeof GmailApp.getDrafts !== 'function') return null;
    const drafts = GmailApp.getDrafts();
    for (let i = 0; i < drafts.length; i++) {
      try {
        const message = drafts[i].getMessage();
        if (message && String(message.getSubject() || '').indexOf('[JHA:' + key + ']') !== -1) return drafts[i];
      } catch (e) { /* ignore an inaccessible draft and continue */ }
    }
    return null;
  },

  persist_(tab, row, values) {
    if (typeof Crm !== 'undefined' && Crm.updateRow && row && row._row) Crm.updateRow(tab, row._row, values);
  },

  draftFor(opp, assets) {
    const cand = Config.promptCandidate();
    const to = opp.contact_email;
    if (!to) return null;
    if (typeof Validation === 'undefined' || !Validation.isEmail(to)) throw new Error('Invalid contact email');
    const operationKey = this.operationKey_(opp, 'application');
    const stored = this.draftById_(opp.draft_id) || this.draftByKey_(operationKey);
    if (stored) return stored.getId();

    const subject = '[JHA:' + operationKey + '] Application: ' + opp.role + ' - ' + cand.name;
    const body = Gemini.generate(Prompts.render('outreach', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role })
    }), { temperature: 0.5, maxOutputTokens: 500 }).trim();

    const draft = GmailApp.createDraft(to, subject, body, {
      name: cand.name,
      attachments: (assets && assets.attachments) || []
    });
    const draftId = draft.getId();
    this.persist_(Crm.TABS.OPPORTUNITIES, opp, { draft_id: draftId, outreach_draft_url: 'gmail-draft:' + draftId, failure_message: '' });
    return draftId;
  },

  draftAgencyOutreach(limit, deadline) {
    limit = typeof Runtime !== 'undefined' ? Runtime.boundedBatch(limit || Config.tunable('AGENCY_DRAFTS_PER_RUN'), 10, 10) : Math.min(Number(limit || 10), 10);
    const cand = Config.promptCandidate();
    const agencies = Crm.readAll(Crm.TABS.CONTACTS).filter(function (c) {
      return c.type === 'agency' && c.email && !c.last_contacted;
    });
    let n = 0;
    const failures = [];
    for (let i = 0; i < agencies.length && n < limit; i++) {
      const a = agencies[i];
      if (typeof Runtime !== 'undefined' && deadline && Runtime.shouldStop(deadline)) break;
      const contactId = String(a.id || '').trim();
      if (!contactId) {
        failures.push(Runtime.failure('agency:' + String(a._row || 'unknown'), new Error('Stable contact ID is required')));
        continue;
      }
      let claimToken = '';
      if (Crm.claim) {
        const claim = Crm.claim(Crm.TABS.CONTACTS, contactId);
        if (claim === false) continue;
        claimToken = typeof claim === 'string' ? claim : '';
      }
      try {
        if (typeof Validation === 'undefined' || !Validation.isEmail(a.email)) throw new Error('Invalid agency contact email');
        const operationKey = this.operationKey_(a, 'agency');
        let draft = this.draftById_(a.draft_id) || this.draftByKey_(operationKey);
        if (!draft) {
          const body = Gemini.generate(Prompts.render('outreach', {
            candidate: JSON.stringify(cand),
            job: JSON.stringify({ company: a.name, role: 'Customer Service / Client Support / Admin - candidate introduction' })
          }), { temperature: 0.5, maxOutputTokens: 500 }).trim();
          draft = GmailApp.createDraft(a.email, '[JHA:' + operationKey + '] Candidate available - Customer Service / Client Support', body, { name: cand.name });
        }
        const draftId = draft.getId();
        this.persist_(Crm.TABS.CONTACTS, a, { draft_id: draftId, last_contacted: new Date(), failure_message: '' });
        n++;
      } catch (e) {
        const failure = Runtime.failure('agency:' + String(a.id || a._row), e);
        try {
          this.persist_(Crm.TABS.CONTACTS, a, { failure_message: failure.message });
        } catch (persistError) {
          failures.push(Runtime.failure('agency failure persistence:' + String(a.id || a._row), persistError));
        }
        failures.push(failure);
      } finally {
        if (claimToken && Crm.releaseClaim) {
          try { Crm.releaseClaim(Crm.TABS.CONTACTS, contactId, claimToken); }
          catch (releaseError) { failures.push(Runtime.failure('agency release:' + contactId, releaseError)); }
        }
      }
    }
    return { created: n, failures: failures };
  },

  // Draft a follow-up email (Gmail draft) for a sent application with no response yet.
  draftFollowUp(opp, stageLabel) {
    const cand = Config.promptCandidate();
    if (!opp.contact_email) return null;
    if (typeof Validation === 'undefined' || !Validation.isEmail(opp.contact_email)) throw new Error('Invalid contact email');
    const marker = String(stageLabel || '').toLowerCase().indexOf('week') !== -1 ? '[fu7]' : '[fu3]';
    const notes = String(opp.notes || '');
    if (notes.indexOf(marker) !== -1) return null;
    const operationKey = this.operationKey_(opp, 'followup:' + marker.slice(3, -1));
    const existing = this.draftByKey_(operationKey);
    if (existing) {
      this.persist_(Crm.TABS.OPPORTUNITIES, opp, { notes: (notes + ' ' + marker + ' ' + existing.getId()).trim(), updated_at: new Date() });
      return existing.getId();
    }
    const body = Gemini.generate(Prompts.render('followup', {
      stage: stageLabel,
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role })
    }), { temperature: 0.5, maxOutputTokens: 400 }).trim();
    const subject = '[JHA:' + operationKey + '] Following up: ' + opp.role + ' - ' + cand.name;
    const draftId = GmailApp.createDraft(opp.contact_email, subject, body, { name: cand.name }).getId();
    this.persist_(Crm.TABS.OPPORTUNITIES, opp, { notes: (notes + ' ' + marker + ' ' + draftId).trim(), updated_at: new Date() });
    return draftId;
  },

  // Best-effort extraction of an application email from posting text. Skips
  // system inboxes (noreply/privacy/legal), job-board domains, and image-name
  // false positives (logo@2x.png) so a junk address never turns a portal role
  // into an "email application". info@/recruitment@ style addresses are
  // deliberately kept - SA SME ads genuinely use them.
  harvestEmail_(text) {
    const all = String(text || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
    const badLocal = /^(no[.\-_]?reply|do[.\-_]?not[.\-_]?reply|donotreply|mailer[.\-_]?daemon|postmaster|privacy|dataprotection|popia|legal|unsubscribe)/i;
    const badDomain = /(adzuna|whatjobs|careers24|indeed|linkedin|glassdoor|pnet|workable|greenhouse|lever\.co|ashby)/i;
    const badTld = /\.(png|jpe?g|gif|svg|webp)$/i;
    for (let i = 0; i < all.length; i++) {
      const at = all[i].lastIndexOf('@');
      const local = all[i].slice(0, at);
      const domain = all[i].slice(at + 1);
      if (badLocal.test(local) || badDomain.test(domain) || badTld.test(domain)) continue;
      return all[i];
    }
    return '';
  }
};
