/**
 * Setup.gs - one-time bootstrap. Run setupProject() once, after:
 *   1. clasp push (this code is in the Apps Script project)
 *   2. GEMINI_API_KEY set in Script Properties
 * It creates the CRM spreadsheet + Drive folder, records their IDs, and seeds
 * the schema. Adzuna keys and MASTER_CV_DOC_ID can be added before or after.
 */
function setupProject() {
  // 1. CRM spreadsheet
  let sheetId = Config.get(Config.KEYS.SHEET_ID);
  if (!sheetId) {
    const ss = SpreadsheetApp.create('Job-Hunt CRM');
    sheetId = ss.getId();
    Config.set(Config.KEYS.SHEET_ID, sheetId);
    Logger.log('Created CRM sheet: ' + ss.getUrl());
  }

  // 2. Drive folder for tailored PDFs
  let folderId = Config.get(Config.KEYS.DRIVE_FOLDER_ID);
  if (!folderId) {
    const folder = DriveApp.createFolder('Job-Hunt - Tailored CVs & Covers');
    folderId = folder.getId();
    Config.set(Config.KEYS.DRIVE_FOLDER_ID, folderId);
    Logger.log('Created Drive folder: ' + folder.getUrl());
  }

  // 3. Schema + seeds
  Crm.ensureSchema();
  seedConfigTab_();
  seedAgenciesFromSample_();
  applySheetUi();   // dropdowns + Readme tab
  seedSetupTab();   // no-code "answer the questions" onboarding form

  Logger.log([
    'Setup complete.',
    'Next steps:',
    ' - Open the "Setup" tab in the new sheet, answer the questions and paste your',
    '   API keys, then tick Save (or run applySetup). That sets your profile + keys.',
    ' - Create the master CV Google Doc (with a {{SUMMARY}} token) and paste its ID',
    '   into the Setup tab, or set MASTER_CV_DOC_ID in Script Properties.',
    ' - Populate the Contacts tab (type=agency) with recruitment agencies.',
    ' - Run dailySource()/scoreQueue() manually once to test, then installTriggers().'
  ].join('\n'));
}

function seedConfigTab_() {
  const sh = Crm.sheet_(Crm.TABS.CONFIG);
  if (sh.getLastRow() > 1) return;
  const rows = [
    ['SCORE_THRESHOLD', Config.defaults.SCORE_THRESHOLD],
    ['DAILY_SOURCE_CAP', Config.defaults.DAILY_SOURCE_CAP],
    ['DAILY_APPROVAL_N', Config.defaults.DAILY_APPROVAL_N],
    ['CHUNK_SIZE', Config.defaults.CHUNK_SIZE],
    ['AGENCY_DRAFTS_PER_RUN', Config.defaults.AGENCY_DRAFTS_PER_RUN]
  ];
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

/**
 * Optional: paste a CSV of agencies into a Script Property named AGENCIES_CSV
 * (columns: name,email,focus) and this seeds the Contacts tab from it.
 */
function seedAgenciesFromSample_() {
  const csv = Config.get('AGENCIES_CSV');
  if (!csv) return;
  const contacts = Crm.readAll(Crm.TABS.CONTACTS);
  if (contacts.length > 0) return;
  const rows = Utilities.parseCsv(csv);
  rows.forEach(function (r, i) {
    if (i === 0 && String(r[0]).toLowerCase() === 'name') return; // header
    if (!r[0]) return;
    Crm.appendRow(Crm.TABS.CONTACTS, {
      id: 'agency_' + i, name: r[0], email: r[1] || '', type: 'agency',
      company: r[0], focus: r[2] || '', last_contacted: '', notes: ''
    });
  });
}
