/**
 * Loop.gs - trigger entry points (global functions the scheduler calls).
 * Each is chunked to respect the 6-minute execution cap.
 */

function dailySource() {
  try {
    Crm.ensureSchema();
    const added = Sources.ingest(Config.tunable('DAILY_SOURCE_CAP'));
    Logger.log('dailySource: added ' + added + ' new opportunities');
  } catch (e) {
    Alerts.notify('dailySource', e);
    throw e;
  }
}

function scoreQueue() {
  try {
    Crm.ensureSchema();
    const r = Match.scoreQueue(Config.tunable('CHUNK_SIZE'));
    Logger.log('scoreQueue: scored ' + r.scored + ', queued ' + r.queued);
  } catch (e) {
    Alerts.notify('scoreQueue', e);
    throw e;
  }
}

/**
 * For each Approvals row a human marked "Approve", build the tailored CV + cover,
 * and (if the posting has a contact email) a Gmail draft with the CV attached.
 * Nothing is sent - the human sends from Gmail / submits portals manually.
 */
function prepApprovedBatch() {
  try {
    return Runtime.withScriptLock('prepApprovedBatch', 5000, function () {
      Crm.ensureSchema();
      const approvals = Crm.readAll(Crm.TABS.APPROVALS).filter(function (a) {
        return String(a.decision).trim().toLowerCase() === 'approve';
      });

      let done = 0;
      const failures = [];
      const cap = Runtime.boundedBatch(Config.tunable('CHUNK_SIZE'), 25, 25);
      const deadline = Runtime.deadlineMs(270000);
      for (let i = 0; i < approvals.length && done < cap && !Runtime.shouldStop(deadline); i++) {
        const a = approvals[i];
        const opp = Crm.findOpportunity(a.id);
        if (!opp) continue;
        if (['drafted', 'submitted', 'sent'].indexOf(opp.status) !== -1) continue;
        let claimToken = '';
        let claimed = true;
        if (Crm.claim) {
          const claim = Crm.claim(Crm.TABS.OPPORTUNITIES, opp.id);
          claimed = claim !== false;
          claimToken = typeof claim === 'string' ? claim : '';
        }
        if (!claimed) continue;

        try {
          // Portal-only roles (no contact email): tailor a CV + cover only if the
          // TAILOR_FOR_PORTALS setting is on. Otherwise flag for manual application.
          if (!opp.contact_email && !Config.tailorForPortals()) {
            Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
              status: 'drafted',
              notes: 'Portal role - apply manually via the job link (tailored docs skipped by setting).',
              updated_at: new Date()
            });
            done++;
            continue;
          }

          const cv = Tailor.tailorCv(opp);
          const cover = Tailor.coverLetter(opp);

          let outreachRef = '';
          let note = 'Ready. Submit via the job link.';
          if (opp.contact_email) {
            const cvBlob = DriveApp.getFileById(cv.pdfId).getBlob();
            const draftId = Outreach.draftFor(opp, { attachments: [cvBlob] });
            outreachRef = draftId ? ('gmail-draft:' + draftId) : '';
            note = 'Gmail draft created (review + send).';
          } else {
            note = 'Portal role - submit manually via the job link with the tailored CV + cover.';
          }

          Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
            cv_pdf_url: cv.pdfUrl, cover_url: cover.pdfUrl, outreach_draft_url: outreachRef,
            status: 'drafted', notes: note, updated_at: new Date(), failure_message: ''
          });
          done++;
        } catch (e) {
          const failure = Runtime.failure('prep:' + a.id, e);
          failures.push(failure);
          if (Crm.recordOpportunityFailure) Crm.recordOpportunityFailure(opp._row, failure.message);
        } finally {
          if (claimToken && Crm.releaseClaim) Crm.releaseClaim(Crm.TABS.OPPORTUNITIES, opp.id, claimToken);
        }
      }
      Logger.log('prepApprovedBatch: prepared ' + done);
      if (failures.length) throw new Error('prepApprovedBatch failures: ' + failures.map(function (f) { return f.name + ': ' + f.message; }).join('; '));
      return done;
    });
  } catch (e) {
    Alerts.notify('prepApprovedBatch', e);
    throw e;
  }
}

/**
 * Draft +3 / +7 day follow-ups (Gmail drafts) for sent applications that have
 * a contact email and no response yet. Markers in `notes` prevent duplicates.
 */
function followUps() {
  try {
    return Runtime.withScriptLock('followUps', 5000, function () {
      Crm.ensureSchema();
      const days = Config.defaults.FOLLOWUP_DAYS;
      const now = new Date();
      const deadline = Runtime.deadlineMs(270000);
      const cap = Runtime.boundedBatch(Config.tunable('CHUNK_SIZE'), 25, 25);
      const rows = Crm.readAll(Crm.TABS.OPPORTUNITIES).filter(function (o) {
        return (o.status === 'sent' || o.status === 'submitted') && o.contact_email && !o.response;
      });
      let n = 0;
      const failures = [];
      for (let i = 0; i < rows.length && n < cap && !Runtime.shouldStop(deadline); i++) {
        const o = rows[i];
        const applied = o.applied_date ? new Date(o.applied_date) : null;
        if (!applied || isNaN(applied.getTime())) continue;
        const ageDays = (now - applied) / 86400000;
        try {
          const draftId = ageDays >= days[1] ? Outreach.draftFollowUp(o, 'a week') : ageDays >= days[0] ? Outreach.draftFollowUp(o, 'a few days') : null;
          if (draftId) n++;
        } catch (e) { failures.push(Runtime.failure('followUp:' + o.id, e)); }
      }
      Logger.log('followUps: drafted ' + n + ' follow-up(s)');
      if (failures.length) throw new Error('followUps failures: ' + failures.map(function (f) { return f.name + ': ' + f.message; }).join('; '));
      return n;
    });
  } catch (e) {
    Alerts.notify('followUps', e);
    throw e;
  }
}

/**
 * Generate an interview-prep pack for any role at status "interview" that
 * doesn't have one yet (a marker + link is written into `notes`).
 */
function prepInterviews() {
  try {
    return Runtime.withScriptLock('prepInterviews', 5000, function () {
      Crm.ensureSchema();
      const rows = Crm.readAll(Crm.TABS.OPPORTUNITIES).filter(function (o) {
        return o.status === 'interview' && String(o.notes || '').indexOf('[interview:') === -1;
      });
      let n = 0;
      const failures = [];
      const cap = Runtime.boundedBatch(Config.tunable('CHUNK_SIZE'), 25, 25);
      const deadline = Runtime.deadlineMs(270000);
      for (let i = 0; i < rows.length && n < cap && !Runtime.shouldStop(deadline); i++) {
        const o = rows[i];
        try {
          InterviewPrep.generateFor(o);
          n++;
        } catch (e) { failures.push(Runtime.failure('interview:' + o.id, e)); }
      }
      Logger.log('prepInterviews: generated ' + n + ' prep pack(s)');
      if (failures.length) throw new Error('prepInterviews failures: ' + failures.map(function (f) { return f.name + ': ' + f.message; }).join('; '));
      return n;
    });
  } catch (e) {
    Alerts.notify('prepInterviews', e);
    throw e;
  }
}

function weeklyReport() {
  try {
    Crm.ensureSchema();
    Report.sendWeekly();
  } catch (e) {
    Alerts.notify('weeklyReport', e);
    throw e;
  }
}

// Draft agency intro emails (run manually or on a light schedule).
function draftAgencyOutreach() {
  try {
    return Runtime.withScriptLock('draftAgencyOutreach', 5000, function () {
      Crm.ensureSchema();
      const result = Outreach.draftAgencyOutreach(Config.tunable('AGENCY_DRAFTS_PER_RUN'), Runtime.deadlineMs(270000));
      Logger.log('draftAgencyOutreach: created ' + result.created + ' agency drafts');
      if (result.failures && result.failures.length) throw new Error('draftAgencyOutreach failures: ' + result.failures.map(function (f) { return f.name + ': ' + f.message; }).join('; '));
      return result.created;
    });
  } catch (e) {
    Alerts.notify('draftAgencyOutreach', e);
    throw e;
  }
}
