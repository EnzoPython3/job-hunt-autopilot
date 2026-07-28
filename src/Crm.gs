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
      'outreach_draft_url', 'applied_date', 'response', 'interview_date', 'notes', 'created_at', 'updated_at',
      'processing_state', 'processing_key', 'processing_started_at', 'cv_file_id', 'cover_file_id', 'draft_id', 'failure_message'],
    Approvals: ['id', 'company', 'role', 'url', 'fit_score', 'track', 'rationale',
      'cv_pdf_url', 'cover_url', 'outreach_draft_url', 'channel', 'decision', 'edited_notes',
      'processing_state', 'processing_key', 'processing_started_at', 'cv_file_id', 'cover_file_id', 'draft_id', 'failure_message'],
    Contacts: ['id', 'name', 'email', 'type', 'company', 'focus', 'last_contacted', 'notes',
      'processing_state', 'processing_key', 'processing_started_at', 'cv_file_id', 'cover_file_id', 'draft_id', 'failure_message'],
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
      const width = Math.max(sh.getLastColumn(), 1);
      const firstRow = sh.getRange(1, 1, 1, width).getValues()[0];
      const empty = firstRow.every(function (c) { return c === '' || c === null; });
      if (empty) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      } else {
        const missing = headers.filter(function (header) { return firstRow.indexOf(header) < 0; });
        if (missing.length) sh.getRange(1, width + 1, 1, missing.length).setValues([missing]);
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
    const width = Math.max(sh.getLastColumn(), 1);
    const actualHeaders = sh.getRange(1, 1, 1, width).getValues()[0];
    const values = sh.getRange(2, 1, last - 1, width).getValues();
    return values.map(function (r, i) {
      const o = { _row: i + 2 };
      headers.forEach(function (h) {
        const c = actualHeaders.indexOf(h);
        o[h] = c >= 0 && c < r.length ? r[c] : '';
      });
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
  },

  claim(tab, stableId, options) {
    const opts = options || {};
    const key = String(stableId || '').trim();
    if (!key) throw new Error('Stable CRM ID is required for a claim');
    const leaseMs = Math.max(1000, Number(opts.leaseMs) || 300000);
    const now = opts.now ? new Date(opts.now) : new Date();
    const runtime = this.Runtime || Runtime;
    const self = this;
    return runtime.withScriptLock('crm-claim:' + tab, Number(opts.waitMs) || 5000, function () {
      const row = self.readAll(tab).filter(function (candidate) {
        return String(candidate.id || '') === key;
      })[0];
      if (!row) return false;
      const started = row.processing_started_at ? new Date(row.processing_started_at).getTime() : 0;
      const active = String(row.processing_state || '') === 'working' && started > 0 &&
        now.getTime() - started < leaseMs;
      if (active) return false;
      self.updateRow(tab, row._row, {
        processing_state: 'working',
        processing_key: key,
        processing_started_at: now,
        failure_message: ''
      });
      return true;
    });
  },

  releaseClaim(tab, stableId, failureMessage) {
    const key = String(stableId || '').trim();
    if (!key) return false;
    const runtime = this.Runtime || Runtime;
    const self = this;
    return runtime.withScriptLock('crm-release:' + tab, 5000, function () {
      const row = self.readAll(tab).filter(function (candidate) {
        return String(candidate.id || '') === key && String(candidate.processing_key || '') === key;
      })[0];
      if (!row) return false;
      self.updateRow(tab, row._row, {
        processing_state: '',
        processing_key: '',
        processing_started_at: '',
        failure_message: failureMessage || ''
      });
      return true;
    });
  }
};
