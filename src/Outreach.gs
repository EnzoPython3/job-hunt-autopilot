/**
 * Outreach.gs - Gmail DRAFTS only. Nothing is ever auto-sent.
 * A human reviews each draft in Gmail and clicks send.
 *
 * Two paths:
 *  - draftFor(opp, assets): a personalised application email to a posting's contact.
 *  - draftAgencyOutreach(): intro emails to the curated recruitment-agency list.
 */
const Outreach = {
  draftFor(opp, assets) {
    const cand = Config.promptCandidate();
    const to = opp.contact_email;
    if (!to) return null;

    const subject = 'Application: ' + opp.role + ' - ' + cand.name;
    const body = Gemini.generate(Prompts.render('outreach', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role })
    }), { temperature: 0.5, maxOutputTokens: 500 }).trim();

    const draft = GmailApp.createDraft(to, subject, body, {
      name: cand.name,
      attachments: (assets && assets.attachments) || []
    });
    return draft.getId();
  },

  draftAgencyOutreach(limit) {
    limit = limit || Config.tunable('AGENCY_DRAFTS_PER_RUN');
    const cand = Config.promptCandidate();
    const agencies = Crm.readAll(Crm.TABS.CONTACTS).filter(function (c) {
      return c.type === 'agency' && c.email && !c.last_contacted;
    });
    let n = 0;
    agencies.slice(0, limit).forEach(function (a) {
      const body = Gemini.generate(Prompts.render('outreach', {
        candidate: JSON.stringify(cand),
        job: JSON.stringify({ company: a.name, role: 'Customer Service / Client Support / Admin - candidate introduction' })
      }), { temperature: 0.5, maxOutputTokens: 500 }).trim();
      GmailApp.createDraft(a.email, 'Candidate available - Customer Service / Client Support', body, { name: cand.name });
      Crm.updateRow(Crm.TABS.CONTACTS, a._row, { last_contacted: new Date() });
      n++;
    });
    return n;
  },

  // Draft a follow-up email (Gmail draft) for a sent application with no response yet.
  draftFollowUp(opp, stageLabel) {
    const cand = Config.promptCandidate();
    if (!opp.contact_email) return null;
    const body = Gemini.generate(Prompts.render('followup', {
      stage: stageLabel,
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role })
    }), { temperature: 0.5, maxOutputTokens: 400 }).trim();
    const subject = 'Following up: ' + opp.role + ' - ' + cand.name;
    return GmailApp.createDraft(opp.contact_email, subject, body, { name: cand.name }).getId();
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
