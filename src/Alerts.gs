/**
 * Alerts.gs - failure notification emails for scheduled trigger runs.
 */
const Alerts = {
  notify(fnName, err) {
    try {
      const to = Config.get('ALERT_EMAIL') || Config.defaults.ALERT_EMAIL;
      const name = alertText_(fnName, 80);
      const detail = alertText_(err && err.stack ? err.stack : String(err), 900);
      MailApp.sendEmail({
        to: to,
        subject: 'Job-Hunt Autopilot: ' + name + ' failed',
        body: 'The scheduled job "' + name + '" failed:\n\n' + detail +
          '\n\nCheck the Apps Script execution log for full details.',
        name: 'Job-Hunt Autopilot'
      });
    } catch (e) {
      // Never call notify from here. A delivery failure must not recurse into
      // another alert attempt or expose the mailer error to the user.
      Logger.log('Alerts.notify: failed to send alert email');
    }
  }
};

function alertText_(value, maximum) {
  let text = '';
  try { text = String(value || ''); } catch (e) { text = 'Unknown failure'; }
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, '[URL]');
  text = text.replace(/\b(?:gemini|adzuna|rapidapi)?[_-]?(?:api\s*[_-]?key|app\s*[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]');
  text = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > maximum) text = text.slice(0, maximum - 3) + '...';
  return text || 'Unknown failure';
}
