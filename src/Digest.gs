/**
 * Digest.gs - morning email digest to the candidate.
 *
 * Sends ONLY if there are roles awaiting a decision in the Approvals tab
 * (decision column still blank). This is a self-notification to you, not
 * outreach in your name - employer emails still stay as human-approved drafts.
 */
function morningDigest() {
  Crm.ensureSchema();

  const pending = Crm.readAll(Crm.TABS.APPROVALS).filter(function (a) {
    return !String(a.decision || '').trim();
  });
  if (!pending.length) {
    Logger.log('morningDigest: nothing to review - no email sent.');
    return;
  }

  pending.sort(function (a, b) { return Number(b.fit_score) - Number(a.fit_score); });

  const cand = Config.candidate();
  const sheetUrl = SpreadsheetApp.openById(Config.require(Config.KEYS.SHEET_ID)).getUrl();
  const noun = pending.length === 1 ? 'role' : 'roles';

  const rows = pending.map(function (a) {
    return '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;"><b>' + htmlEscape_(a.fit_score) + '</b></td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + htmlEscape_(a.role) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + htmlEscape_(a.company) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + htmlEscape_(a.track) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + (a.url ? '<a href="' + htmlEscape_(a.url) + '">view</a>' : '') + '</td>' +
      '</tr>';
  }).join('');

  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#333;">' +
    '<h2 style="margin:0 0 2px;">Good morning, ' + htmlEscape_(cand.firstName) + '</h2>' +
    '<p style="margin:0 0 12px;color:#555;">' + pending.length + ' new ' + noun + ' to review.</p>' +
    '<table style="border-collapse:collapse;font-size:14px;">' +
    '<tr>' +
    '<th align="left" style="padding:6px 10px;border-bottom:2px solid #ccc;">Fit</th>' +
    '<th align="left" style="padding:6px 10px;border-bottom:2px solid #ccc;">Role</th>' +
    '<th align="left" style="padding:6px 10px;border-bottom:2px solid #ccc;">Company</th>' +
    '<th align="left" style="padding:6px 10px;border-bottom:2px solid #ccc;">Track</th>' +
    '<th style="border-bottom:2px solid #ccc;"></th>' +
    '</tr>' + rows + '</table>' +
    '<p style="margin:16px 0;"><a href="' + htmlEscape_(sheetUrl) + '" style="background:#6b6b6b;color:#fff;padding:9px 16px;border-radius:4px;text-decoration:none;">Open the Approvals sheet</a></p>' +
    '<p style="font-size:12px;color:#888;">Type "Approve" in the decision column for the ones you want. Tailored CVs, cover letters and email drafts are then prepared automatically.</p>' +
    '</div>';

  const plain = 'Good morning ' + cand.firstName + '\n\n' + pending.length + ' new ' + noun + ' to review:\n' +
    pending.map(function (a) { return '  [' + a.fit_score + '] ' + a.role + ' @ ' + a.company + '  ' + (a.url || ''); }).join('\n') +
    '\n\nApprovals sheet: ' + sheetUrl;

  try {
    MailApp.sendEmail({
      to: cand.email,
      subject: 'Job digest: ' + pending.length + ' new ' + noun + ' to review',
      body: plain,
      htmlBody: html,
      name: 'Job-Hunt Autopilot'
    });
    Logger.log('morningDigest: sent ' + pending.length + ' item(s) to ' + cand.email);
  } catch (e) {
    // Almost always a missing send_mail authorisation - re-run the project
    // once from the editor and grant permissions, then re-install triggers.
    Logger.log('morningDigest: SEND FAILED (' + cand.email + '): ' + e);
    throw e;
  }
}

function htmlEscape_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
