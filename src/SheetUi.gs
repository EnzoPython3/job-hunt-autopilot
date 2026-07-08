/**
 * SheetUi.gs - human-facing conveniences on the CRM sheet:
 *   - dropdowns for the columns you edit by hand (Opportunities.status, Approvals.decision)
 *   - auto-stamp Opportunities.applied_date the moment you pick "sent"/"submitted"
 *   - a "Readme" tab with a what-to-do-when reference
 *
 * Run applySheetUi() once (setupProject() also calls it). The auto-stamp needs
 * the installable onEdit trigger that installTriggers() creates.
 */

const STATUS_VALUES = ['sourced', 'scored', 'queued_for_approval', 'drafted',
  'submitted', 'sent', 'responded', 'interview', 'offer', 'rejected', 'dead_link'];
const DECISION_VALUES = ['Approve', 'Skip'];

function applySheetUi() {
  Crm.ensureSchema();
  applyDropdowns_();
  buildReadmeTab_();
  Logger.log('Sheet UI applied: status/decision dropdowns + Readme tab.');
}

function applyDropdowns_() {
  setColumnDropdown_(Crm.TABS.OPPORTUNITIES, 'status', STATUS_VALUES);
  setColumnDropdown_(Crm.TABS.APPROVALS, 'decision', DECISION_VALUES);
}

function setColumnDropdown_(tab, header, values) {
  const sh = Crm.sheet_(tab);
  const col = Crm.colIndex(tab, header);
  if (col < 1) return;
  const numRows = sh.getMaxRows() - 1;   // every row under the header
  if (numRows < 1) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(true)               // never reject a value the code writes
    .build();
  sh.getRange(2, col, numRows, 1).setDataValidation(rule);
}

/**
 * Installable onEdit handler (see installTriggers). When you set an
 * Opportunities row's status to sent/submitted, fill applied_date with today
 * if it is still blank - so follow-ups have a date to count from.
 */
function onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() === SETUP_TAB) { maybeSaveSetup_(e); return; }
    if (sh.getName() !== Crm.TABS.OPPORTUNITIES) return;
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    if (e.range.getColumn() !== Crm.colIndex(Crm.TABS.OPPORTUNITIES, 'status')) return;

    const val = String(e.value || '').trim().toLowerCase();
    if (val !== 'sent' && val !== 'submitted') return;

    const row = e.range.getRow();
    if (row < 2) return;
    const cell = sh.getRange(row, Crm.colIndex(Crm.TABS.OPPORTUNITIES, 'applied_date'));
    if (String(cell.getValue()).trim() === '') cell.setValue(new Date());
  } catch (err) {
    Logger.log('onSheetEdit: ' + err);
  }
}

function buildReadmeTab_() {
  const ss = SpreadsheetApp.openById(Config.require(Config.KEYS.SHEET_ID));
  let sh = ss.getSheetByName('Readme');
  if (!sh) sh = ss.insertSheet('Readme');
  sh.clear();
  try { ss.setActiveSheet(sh); ss.moveActiveSheet(1); } catch (e) { /* ignore */ }

  const H = true, P = false;
  const rows = [
    ['Job-Hunt CRM - Quick Reference', H],
    ['', P],
    ['1. Every day (about 10 minutes)', H],
    ['Open the Approvals tab. For each row read the role, company, fit_score and rationale, and open the job link.', P],
    ['In the "decision" column pick Approve (or Skip) from the dropdown.', P],
    ['Within ~2 hours the system tailors a CV + cover letter (PDF in Drive) and, where the posting has an email, a Gmail draft with the CV attached.', P],
    ['', P],
    ['2. When a draft / CV is ready (Opportunities tab)', H],
    ['Review the Gmail draft, tweak it, and send. For portal-only roles, open the job link and submit manually using the tailored CV + cover from the Drive folder.', P],
    ['Then on that Opportunities row, set the "status" dropdown:', P],
    ['      sent = you emailed the application', P],
    ['      submitted = you applied through a portal', P],
    ['"applied_date" fills in with today automatically when you choose sent or submitted - you do not type it.', P],
    ['', P],
    ['3. Follow-ups (automatic)', H],
    ['3 and 7 days after applied_date, follow-up Gmail drafts are created for emailed applications with no reply yet. Review and send them.', P],
    ['Portal-only roles with no contact email are not followed up automatically - chase those yourself.', P],
    ['', P],
    ['4. When you hear back (Opportunities tab)', H],
    ['Put their reply in the "response" column and set "status" to responded.', P],
    ['If an interview is booked, set "status" to interview and fill in "interview_date". An interview-prep Google Doc is generated automatically (link appears in "notes").', P],
    ['Finally set "status" to offer or rejected.', P],
    ['', P],
    ['5. What the statuses mean', H],
    ['sourced / scored / queued_for_approval / drafted - set by the system automatically.', P],
    ['submitted / sent / responded / interview / offer / rejected - you set these by hand.', P],
    ['dead_link - the job link was dead, so it was skipped.', P],
    ['', P],
    ['6. The tabs', H],
    ['Opportunities - every job and its full history (the master record).', P],
    ['Approvals - your daily review queue; only pick Approve/Skip here.', P],
    ['Contacts - recruitment agencies.   Config / KPIs - system settings and stats.', P],
    ['', P],
    ['7. The automatic schedule (Johannesburg time)', H],
    ['06:00 pull new jobs   |   hourly score fit   |   every 2h prepare approved roles', P],
    ['07:00 morning digest email   |   08:00 follow-up drafts   |   09:00 interview prep   |   Mon 07:00 weekly report', P]
  ];

  sh.getRange(1, 1, rows.length, 1).setValues(rows.map(function (r) { return [r[0]]; }));
  sh.setColumnWidth(1, 780);
  sh.getRange(1, 1).setFontSize(14);
  rows.forEach(function (r, i) {
    if (r[1] === H) sh.getRange(i + 1, 1).setFontWeight('bold');
  });
  sh.setFrozenRows(1);
  try { sh.getRange(1, 1, rows.length, 1).setWrap(true); } catch (e) { /* ignore */ }
  try { sh.setHiddenGridlines(true); } catch (e) { /* ignore */ }
}
