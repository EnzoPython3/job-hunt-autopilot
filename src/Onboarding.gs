/**
 * Onboarding.gs - a no-code "answer the questions" setup form.
 *
 * It lives as a "Setup" tab in the CRM sheet. The candidate types their answers
 * in column B, then EITHER ticks the Save checkbox (works once installTriggers()
 * is on, via the installable onEdit trigger) OR runs applySetup() from the Run
 * menu. applySetup() writes the profile answers to the CANDIDATE_JSON Script
 * Property and each pasted API key to Script Properties, then blanks the secret
 * cells so keys do not linger in the sheet.
 *
 * seedSetupTab() is called by setupProject(); re-run it any time to refresh the
 * form (it preserves answers already typed).
 */

const SETUP_TAB = 'Setup';

// Ordered form definition.
// type: section | text | list | salary | prop | save | status
// target: candidate field (text/list/salary) or Script Property key (prop).
const SETUP_FIELDS = [
  { type: 'section', label: 'YOUR PROFILE  -  type answers in column B, then Save at the bottom' },
  { type: 'text',   label: 'Full name',                                             target: 'name' },
  { type: 'text',   label: 'Email (where your digests and outreach drafts go)',     target: 'email' },
  { type: 'text',   label: 'Phone',                                                 target: 'phone' },
  { type: 'text',   label: 'Location (City, Province, Country)',                     target: 'location' },
  { type: 'text',   label: 'LinkedIn URL',                                          target: 'linkedin' },
  { type: 'list',   label: 'Target roles (comma-separated)',                        target: 'tracks' },
  { type: 'list',   label: 'Regions / cities you will work in (comma-separated)',   target: 'geos' },
  { type: 'list',   label: 'Skill keywords (comma-separated)',                      target: 'keywords' },
  { type: 'salary', label: 'Salary target net per month, low and high (e.g. 15000, 20000 or R15 000 - R20 000) - private, never shown', target: 'salaryTargetNet' },
  { type: 'text',   label: 'One-line summary of you (feeds fit-scoring and your CV summary)', target: 'summary' },
  { type: 'section', label: 'API KEYS  -  paste each; on Save they move to secure storage and these cells are cleared' },
  { type: 'prop',   label: 'Gemini API key',                       target: 'GEMINI_API_KEY', secret: true },
  { type: 'prop',   label: 'Adzuna App ID',                        target: 'ADZUNA_APP_ID' },
  { type: 'prop',   label: 'Adzuna App Key',                       target: 'ADZUNA_APP_KEY', secret: true },
  { type: 'prop',   label: 'RapidAPI key (optional, for JSearch)', target: 'RAPIDAPI_KEY', secret: true },
  { type: 'prop',   label: 'Master CV Google Doc ID (the Doc that contains a {{SUMMARY}} token)', target: 'MASTER_CV_DOC_ID' },
  { type: 'section', label: 'SEARCH FILTERS  -  optional; blank = not set (blanking a filled row clears that filter on Save)' },
  { type: 'prop',   label: 'Keep ONLY these regions, comma-separated (blank = anywhere)',              target: 'ALLOWED_REGIONS', clearable: true },
  { type: 'prop',   label: 'Drop these sub-areas even if in range, comma-separated (blank = none)',    target: 'EXCLUDED_REGIONS', clearable: true },
  { type: 'prop',   label: 'Allow remote jobs from anywhere? true/false (default true)',              target: 'ALLOW_REMOTE', clearable: true },
  { type: 'prop',   label: 'Exclude these job boards, comma-separated e.g. careers24 (blank = none)', target: 'EXCLUDED_DOMAINS', clearable: true },
  { type: 'prop',   label: 'Tailor CV/cover for portal roles too? true/false; false = email-only (default true)', target: 'TAILOR_FOR_PORTALS', clearable: true },
  { type: 'section', label: 'SAVE' },
  { type: 'save',   label: 'Tick this box to save   (or run applySetup from the Run menu)' },
  { type: 'status', label: 'Status' }
];

function setupKey_(s) { return String(s).trim().toLowerCase(); }

/** Build (or refresh) the Setup tab, preserving any answers already typed. */
function seedSetupTab() {
  const ss = SpreadsheetApp.openById(Config.require(Config.KEYS.SHEET_ID));
  let sh = ss.getSheetByName(SETUP_TAB);
  if (!sh) sh = ss.insertSheet(SETUP_TAB);

  const prior = readSetupAnswers_(sh);   // keep what the user already typed
  const cand = Config.candidate();
  sh.clear();

  const rows = SETUP_FIELDS.map(function (f) {
    let b = '';
    const priorVal = prior[setupKey_(f.label)];
    if (f.type === 'text' || f.type === 'list' || f.type === 'salary') {
      b = (priorVal !== undefined && priorVal !== '') ? priorVal : candidateDisplay_(cand, f);
    } else if (f.type === 'prop') {
      b = (priorVal !== undefined) ? priorVal : '';   // never surface stored secrets
    }
    return [f.label, b];
  });

  sh.getRange(1, 1, rows.length, 2).setValues(rows);

  // Formatting
  sh.setColumnWidth(1, 420);
  sh.setColumnWidth(2, 460);
  sh.setFrozenColumns(1);
  SETUP_FIELDS.forEach(function (f, i) {
    const r = i + 1;
    if (f.type === 'section') {
      sh.getRange(r, 1, 1, 2).setFontWeight('bold').setBackground('#e8eaed');
    }
    if (f.type === 'status') sh.getRange(r, 1).setFontWeight('bold');
  });
  try { sh.getRange(1, 1, rows.length, 2).setWrap(true); } catch (e) { /* ignore */ }
  try { sh.setHiddenGridlines(true); } catch (e) { /* ignore */ }

  // Save checkbox
  const saveRow = rowOfType_('save');
  if (saveRow) sh.getRange(saveRow, 2).insertCheckboxes().setValue(false);

  // The Save checkbox only works once installTriggers() has run - say so upfront
  // instead of letting a tick silently do nothing.
  const statusRow = rowOfType_('status');
  if (statusRow) {
    sh.getRange(statusRow, 2).setValue(
      'Not saved yet. The Save checkbox works after installTriggers has been run - until then, run applySetup from the script editor instead.');
  }

  try { ss.setActiveSheet(sh); ss.moveActiveSheet(1); } catch (e) { /* ignore */ }
  Logger.log('Setup tab ready. Fill it in, then tick Save (or run applySetup).');
}

/** Read the answers into the CANDIDATE_JSON property + Script Properties. */
function applySetup() {
  const ss = SpreadsheetApp.openById(Config.require(Config.KEYS.SHEET_ID));
  const sh = ss.getSheetByName(SETUP_TAB);
  if (!sh) throw new Error('No Setup tab yet - run setupProject() (or seedSetupTab()) first.');

  const ans = readSetupAnswers_(sh);
  const cand = Config.candidate();   // base = current profile (default or existing CANDIDATE_JSON)
  const keysSet = [];
  const clearRows = [];

  SETUP_FIELDS.forEach(function (f) {
    if (!f.target) return;
    const raw = ans[setupKey_(f.label)];
    if (raw === undefined) return;
    const v = String(raw).trim();
    if (f.type === 'text') {
      if (v) cand[f.target] = v;
    } else if (f.type === 'list') {
      if (v) cand[f.target] = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    } else if (f.type === 'salary') {
      if (v) {
        const nums = parseSalaryRange_(v);
        if (nums.length >= 2) cand[f.target] = [nums[0], nums[1]];
        else if (nums.length === 1) cand[f.target] = [nums[0], nums[0]];
      }
    } else if (f.type === 'prop') {
      if (v) {
        Config.set(f.target, v);
        keysSet.push(f.target);
        if (f.secret) clearRows.push(f.label);
      } else if (f.clearable) {
        // Non-secret filter cells keep their value visible, so a blank means the
        // user cleared it - remove the stored property. (Secrets are auto-blanked
        // after save and must never be deleted on a blank cell; likewise
        // MASTER_CV_DOC_ID, which buildMasterCv() may have set outside the form.)
        Config.remove(f.target);
      }
    }
  });

  // Derive firstName from name; keep the remote flags sensible.
  const nm = String(cand.name || '').trim();
  if (nm && nm !== 'Your Full Name') cand.firstName = nm.split(/\s+/)[0];
  if (cand.remoteOk === undefined) cand.remoteOk = true;
  if (cand.internationalRemoteOk === undefined) cand.internationalRemoteOk = true;

  Config.set(Config.KEYS.CANDIDATE_JSON, JSON.stringify(cand));

  // Clear saved secret cells + reset the Save checkbox.
  clearRows.forEach(function (label) {
    const r = rowOfLabel_(sh, label);
    if (r) sh.getRange(r, 2).setValue('');
  });
  const saveRow = rowOfType_('save');
  if (saveRow) { try { sh.getRange(saveRow, 2).setValue(false); } catch (e) { /* ignore */ } }

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const msg = 'Saved ' + stamp + '. Profile updated'
    + (keysSet.length ? '; keys stored: ' + keysSet.join(', ') : '')
    + (clearRows.length ? '; secret cells cleared.' : '.');
  const statusRow = rowOfType_('status');
  if (statusRow) sh.getRange(statusRow, 2).setValue(msg);
  Logger.log(msg);
  return msg;
}

/** Called from onSheetEdit when the Setup tab's Save checkbox is ticked. */
function maybeSaveSetup_(e) {
  try {
    const sh = e.range.getSheet();
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    if (e.range.getColumn() !== 2) return;
    const label = String(sh.getRange(e.range.getRow(), 1).getValue() || '').trim();
    const saveField = SETUP_FIELDS.filter(function (f) { return f.type === 'save'; })[0];
    if (!saveField || setupKey_(label) !== setupKey_(saveField.label)) return;
    if (String(e.value).toLowerCase() === 'true') applySetup();
  } catch (err) {
    Logger.log('maybeSaveSetup_: ' + err);
  }
}

// --- helpers ---

/**
 * Parse a salary range typed in any common form: "15000, 20000",
 * "R15 000 - R20 000", "R15,000-R20,000". Thousands separators (a space or comma
 * followed by exactly three digits) are collapsed first, then the number groups
 * are extracted in order. Returns an array of numbers (possibly empty).
 */
function parseSalaryRange_(v) {
  const collapsed = String(v).replace(/(\d)[ ,](?=\d{3}(\D|$))/g, '$1');
  return (collapsed.match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter(function (n) { return !isNaN(n) && n > 0; });
}

function readSetupAnswers_(sh) {
  const out = {};
  const last = sh.getLastRow();
  if (last < 1) return out;
  const vals = sh.getRange(1, 1, last, 2).getValues();
  vals.forEach(function (r) {
    const label = String(r[0] || '').trim();
    if (label) out[setupKey_(label)] = r[1];
  });
  return out;
}

function candidateDisplay_(cand, f) {
  const val = cand[f.target];
  if (val === undefined || val === null) return '';
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

function rowOfType_(type) {
  for (let i = 0; i < SETUP_FIELDS.length; i++) if (SETUP_FIELDS[i].type === type) return i + 1;
  return 0;
}

function rowOfLabel_(sh, label) {
  const last = sh.getLastRow();
  if (last < 1) return 0;
  const col = sh.getRange(1, 1, last, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (setupKey_(col[i][0]) === setupKey_(label)) return i + 1;
  }
  return 0;
}
