/**
 * Diagnostics.gs - run diagnose() and read the Execution log.
 * Checks which Script Properties are set and live-tests Adzuna + Gemini + the sheet.
 */
function diagnose() {
  const out = [];
  const P = PropertiesService.getScriptProperties();
  const has = function (k) { const v = P.getProperty(k); return v ? ('SET (' + String(v).length + ' chars)') : 'NOT SET'; };

  out.push('=== Script Properties ===');
  ['GEMINI_API_KEY', 'GEMINI_MODEL', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'ADZUNA_API_KEY',
    'RAPIDAPI_KEY', 'SHEET_ID', 'DRIVE_FOLDER_ID', 'MASTER_CV_DOC_ID', 'CANDIDATE_JSON'].forEach(function (k) {
    out.push('  ' + k + ': ' + has(k));
  });

  out.push('=== Adzuna live test ===');
  try {
    const appId = P.getProperty('ADZUNA_APP_ID');
    const appKey = P.getProperty('ADZUNA_APP_KEY') || P.getProperty('ADZUNA_API_KEY');
    if (!appId || !appKey) {
      out.push('  SKIP - app id and/or key missing (this is why dailySource added 0)');
    } else {
      const url = 'https://api.adzuna.com/v1/api/jobs/za/search/1?app_id=' + encodeURIComponent(appId) +
        '&app_key=' + encodeURIComponent(appKey) + '&results_per_page=3&what=' +
        encodeURIComponent('customer service') + '&sort_by=date&max_days_old=21&content-type=application/json';
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      out.push('  HTTP ' + res.getResponseCode());
      const body = res.getContentText();
      try {
        const d = JSON.parse(body);
        if (d.exception) out.push('  exception: ' + d.exception);
        else out.push('  count: ' + d.count + ', results returned: ' + (d.results ? d.results.length : 0));
      } catch (e) { out.push('  body: ' + body.slice(0, 200)); }
    }
  } catch (e) { out.push('  ERROR: ' + e); }

  out.push('=== JSearch live test ===');
  try {
    const key = P.getProperty('RAPIDAPI_KEY');
    if (!key) {
      out.push('  SKIP - RAPIDAPI_KEY missing (JSearch source disabled until set)');
    } else {
      const url = 'https://jsearch.p.rapidapi.com/search-v2?query=' +
        encodeURIComponent('customer service in South Africa') +
        '&country=za&date_posted=week';
      const res = UrlFetchApp.fetch(url, {
        method: 'get', muteHttpExceptions: true,
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }
      });
      out.push('  HTTP ' + res.getResponseCode());
      const body = res.getContentText();
      if (res.getResponseCode() !== 200) {
        // 404/403 here is a RapidAPI subscription/key issue - the body says which.
        out.push('  body: ' + body.slice(0, 200));
      } else {
        try {
          const d = JSON.parse(body);
          const arr = Sources.pickJobs_(d);
          const n = arr.length;
          out.push('  results returned: ' + n + (n
            ? ('  sample link: ' + (arr[0].job_apply_link || '').slice(0, 80))
            : ('  top-level keys: ' + Object.keys(d).join(',') + '  body: ' + body.slice(0, 200))));
        } catch (e) { out.push('  body: ' + body.slice(0, 200)); }
      }
    }
  } catch (e) { out.push('  ERROR: ' + e); }

  out.push('=== Gemini live test ===');
  try {
    const r = Gemini.generate('Reply with exactly: ok', { maxOutputTokens: 10 });
    out.push('  reply: ' + String(r).trim().slice(0, 40));
  } catch (e) { out.push('  ERROR: ' + e); }

  out.push('=== Sheet ===');
  try {
    out.push('  Opportunities rows: ' + Crm.readAll(Crm.TABS.OPPORTUNITIES).length);
  } catch (e) { out.push('  ERROR: ' + e); }

  const report = out.join('\n');
  Logger.log(report);
  return report;
}

/**
 * One-off maintenance: follow every stored job link and retire the dead ones.
 * Opportunities -> status 'dead_link'; Approvals -> decision 'Skip - dead link'
 * (which also drops it from the morning digest, which only lists blank-decision rows).
 * Non-destructive - rows are kept for the record, just flagged.
 * Capped per run to stay under the 6-minute limit; re-run until it reports 0 remaining.
 */
function pruneDeadLinks() {
  Crm.ensureSchema();
  const MAX_CHECKS = 150;
  let budget = MAX_CHECKS;
  let oppDead = 0, oppChecked = 0, apprDead = 0, apprChecked = 0, capped = false;

  Crm.readAll(Crm.TABS.OPPORTUNITIES).forEach(function (o) {
    if (!o.url || o.status === 'dead_link') return;
    if (budget <= 0) { capped = true; return; }
    budget--; oppChecked++;
    if (!Sources.linkAlive_(o.url)) {
      Crm.updateRow(Crm.TABS.OPPORTUNITIES, o._row, {
        status: 'dead_link',
        notes: String(o.notes || '') + ' [pruned: dead link]',
        updated_at: new Date()
      });
      oppDead++;
    }
  });

  Crm.readAll(Crm.TABS.APPROVALS).forEach(function (a) {
    if (!a.url || String(a.decision || '').trim()) return;   // leave already-decided rows alone
    if (budget <= 0) { capped = true; return; }
    budget--; apprChecked++;
    if (!Sources.linkAlive_(a.url)) {
      Crm.updateRow(Crm.TABS.APPROVALS, a._row, {
        decision: 'Skip - dead link',
        edited_notes: String(a.edited_notes || '') + ' [pruned: dead link]'
      });
      apprDead++;
    }
  });

  const report = 'pruneDeadLinks: Opportunities ' + oppDead + '/' + oppChecked + ' dead; ' +
    'Approvals ' + apprDead + '/' + apprChecked + ' dead.' +
    (capped ? ' CAPPED at ' + MAX_CHECKS + ' checks - re-run to continue.' : ' Done.');
  Logger.log(report);
  return report;
}
