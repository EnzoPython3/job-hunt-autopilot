/**
 * Loop.gs - trigger entry points (global functions the scheduler calls).
 * Each is chunked to respect the 6-minute execution cap.
 */

function dailySource() {
  Crm.ensureSchema();
  const added = Sources.ingest(Config.tunable('DAILY_SOURCE_CAP'));
  Logger.log('dailySource: added ' + added + ' new opportunities');
}

function scoreQueue() {
  Crm.ensureSchema();
  const r = Match.scoreQueue(Config.tunable('CHUNK_SIZE'));
  Logger.log('scoreQueue: scored ' + r.scored + ', queued ' + r.queued);
}

/**
 * For each Approvals row a human marked "Approve", build the tailored CV + cover,
 * and (if the posting has a contact email) a Gmail draft with the CV attached.
 * Nothing is sent - the human sends from Gmail / submits portals manually.
 */
function prepApprovedBatch() {
  Crm.ensureSchema();
  const approvals = Crm.readAll(Crm.TABS.APPROVALS).filter(function (a) {
    return String(a.decision).trim().toLowerCase() === 'approve';
  });

  let done = 0;
  const cap = Config.tunable('CHUNK_SIZE');
  for (let i = 0; i < approvals.length && done < cap; i++) {
    const a = approvals[i];
    const opp = Crm.findOpportunity(a.id);
    if (!opp) continue;
    if (['drafted', 'submitted', 'sent'].indexOf(opp.status) !== -1) continue;

    try {
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
        status: 'drafted', notes: note, updated_at: new Date()
      });
      done++;
    } catch (e) {
      Logger.log('prep ' + a.id + ': ' + e);
    }
  }
  Logger.log('prepApprovedBatch: prepared ' + done);
}

/**
 * Draft +3 / +7 day follow-ups (Gmail drafts) for sent applications that have
 * a contact email and no response yet. Markers in `notes` prevent duplicates.
 */
function followUps() {
  Crm.ensureSchema();
  const days = Config.defaults.FOLLOWUP_DAYS; // [3, 7]
  const now = new Date();
  const rows = Crm.readAll(Crm.TABS.OPPORTUNITIES).filter(function (o) {
    return (o.status === 'sent' || o.status === 'submitted') && o.contact_email && !o.response;
  });

  let n = 0;
  rows.forEach(function (o) {
    const applied = o.applied_date ? new Date(o.applied_date) : null;
    if (!applied || isNaN(applied.getTime())) return;
    const ageDays = (now - applied) / 86400000;
    const notes = String(o.notes || '');
    try {
      if (ageDays >= days[1] && notes.indexOf('[fu7]') === -1) {
        Outreach.draftFollowUp(o, 'a week');
        Crm.updateRow(Crm.TABS.OPPORTUNITIES, o._row, { notes: (notes + ' [fu7]').trim(), updated_at: now });
        n++;
      } else if (ageDays >= days[0] && notes.indexOf('[fu3]') === -1) {
        Outreach.draftFollowUp(o, 'a few days');
        Crm.updateRow(Crm.TABS.OPPORTUNITIES, o._row, { notes: (notes + ' [fu3]').trim(), updated_at: now });
        n++;
      }
    } catch (e) { Logger.log('followUp ' + o.id + ': ' + e); }
  });
  Logger.log('followUps: drafted ' + n + ' follow-up(s)');
}

/**
 * Generate an interview-prep pack for any role at status "interview" that
 * doesn't have one yet (a marker + link is written into `notes`).
 */
function prepInterviews() {
  Crm.ensureSchema();
  const rows = Crm.readAll(Crm.TABS.OPPORTUNITIES).filter(function (o) {
    return o.status === 'interview' && String(o.notes || '').indexOf('[prepped]') === -1;
  });
  let n = 0;
  const cap = Config.tunable('CHUNK_SIZE');
  for (let i = 0; i < rows.length && n < cap; i++) {
    const o = rows[i];
    try {
      const r = InterviewPrep.generateFor(o);
      Crm.updateRow(Crm.TABS.OPPORTUNITIES, o._row, {
        notes: (String(o.notes || '') + ' [prepped] ' + r.docUrl).trim(), updated_at: new Date()
      });
      n++;
    } catch (e) { Logger.log('prepInterviews ' + o.id + ': ' + e); }
  }
  Logger.log('prepInterviews: generated ' + n + ' prep pack(s)');
}

function weeklyReport() {
  Crm.ensureSchema();
  Report.sendWeekly();
}

// Draft agency intro emails (run manually or on a light schedule).
function draftAgencyOutreach() {
  Crm.ensureSchema();
  const n = Outreach.draftAgencyOutreach(Config.tunable('AGENCY_DRAFTS_PER_RUN'));
  Logger.log('draftAgencyOutreach: created ' + n + ' agency drafts');
}
