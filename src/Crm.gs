/**
 * Crm.gs - the Google Sheet is the application CRM.
 * One tab per concern; this module owns the schema and all reads/writes.
 */
const Crm = {
  TABS: {
    OPPORTUNITIES: 'Opportunities',
    APPROVALS: 'Approvals',
    CONTACTS: 'Contacts',
    KPIS: 'KPIs',
    CONFIG: 'Config'
  },

  HEADERS: {
    Opportunities: ['id', 'source', 'company', 'role', 'location', 'mode', 'url', 'contact_email',
      'posted_date', 'fit_score', 'track', 'rationale', 'status', 'cv_pdf_url', 'cover_url',
      'outreach_draft_url', 'applied_date', 'response', 'interview_date', 'notes', 'created_at', 'updated_at'],
    Approvals: ['id', 'company', 'role', 'url', 'fit_score', 'track', 'rationale',
      'cv_pdf_url', 'cover_url', 'outreach_draft_url', 'channel', 'decision', 'edited_notes'],
    Contacts: ['id', 'name', 'email', 'type', 'company', 'focus', 'last_contacted', 'notes'],
    KPIs: ['week_start', 'sourced', 'scored', 'queued', 'approved', 'submitted', 'sent', 'responses', 'interviews', 'notes'],
    Config: ['key', 'value']
  },

  ss_() {
    return SpreadsheetApp.openById(Config.require(Config.KEYS.SHEET_ID));
  },

  sheet_(tab) {
    const ss = this.ss_();
    let sh = ss.getSheetByName(tab);
    if (!sh) sh = ss.insertSheet(tab);
    return sh;
  },

  ensureSchema() {
    const ss = this.ss_();
    const self = this;
    Object.keys(this.HEADERS).forEach(function (tab) {
      let sh = ss.getSheetByName(tab);
      if (!sh) sh = ss.insertSheet(tab);
      const headers = self.HEADERS[tab];
      const firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
      const empty = firstRow.every(function (c) { return c === '' || c === null; });
      if (empty) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      }
    });
    const def = ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (e) { /* ignore */ } }
  },

  // 1-based column number for a header on a tab (0 if the header is unknown).
  colIndex(tab, header) {
    return this.HEADERS[tab].indexOf(header) + 1;
  },

  appendRow(tab, obj) {
    const headers = this.HEADERS[tab];
    const row = headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
    this.sheet_(tab).appendRow(row);
  },

  readAll(tab) {
    const sh = this.sheet_(tab);
    const last = sh.getLastRow();
    if (last < 2) return [];
    const headers = this.HEADERS[tab];
    const values = sh.getRange(2, 1, last - 1, headers.length).getValues();
    return values.map(function (r, i) {
      const o = { _row: i + 2 };
      headers.forEach(function (h, c) { o[h] = r[c]; });
      return o;
    });
  },

  updateRow(tab, rowNumber, obj) {
    const headers = this.HEADERS[tab];
    const sh = this.sheet_(tab);
    const current = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    headers.forEach(function (h, c) { if (obj[h] !== undefined) current[c] = obj[h]; });
    sh.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
  },

  findOpportunity(id) {
    const rows = this.readAll(this.TABS.OPPORTUNITIES);
    for (let i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  },

  existsOpportunity(id) {
    return this.findOpportunity(id) !== null;
  },

  listByStatus(status) {
    return this.readAll(this.TABS.OPPORTUNITIES).filter(function (o) { return o.status === status; });
  },

  setStatus(rowNumber, status) {
    this.updateRow(this.TABS.OPPORTUNITIES, rowNumber, { status: status, updated_at: new Date() });
  }
};
