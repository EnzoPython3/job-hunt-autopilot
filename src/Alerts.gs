/**
 * Alerts.gs - failure notification emails for scheduled trigger runs.
 */
const Alerts = {
  notify(fnName, err) {
    try {
      const to = Config.get('ALERT_EMAIL') || Config.defaults.ALERT_EMAIL;
      MailApp.sendEmail({
        to: to,
        subject: 'Job-Hunt Autopilot: ' + fnName + ' failed',
        body: 'The scheduled job "' + fnName + '" failed:\n\n' +
          (err && err.stack ? err.stack : String(err)) +
          '\n\nCheck the Apps Script execution log for full details.' +
          '\n\nStuck? Open an issue: https://github.com/EnzoPython3/job-hunt-autopilot/issues' +
          '\nor DM Enzo on LinkedIn: https://www.linkedin.com/in/enzo-snyman/',
        name: 'Job-Hunt Autopilot'
      });
    } catch (e) {
      Logger.log('Alerts.notify: failed to send alert email: ' + e);
    }
  }
};
