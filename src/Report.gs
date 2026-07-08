/**
 * Report.gs - weekly KPI + funnel summary.
 * Creates a Gmail DRAFT to the script owner (nothing auto-sends, per the
 * Assisted guardrail). Open Gmail to read/forward it.
 */
const Report = {
  sendWeekly() {
    const opps = Crm.readAll(Crm.TABS.OPPORTUNITIES);
    const count = function (s) { return opps.filter(function (o) { return o.status === s; }).length; };
    const interviews = count('interview');
    const responses = opps.filter(function (o) { return o.response; }).length;

    const lines = [
      'Job-Hunt - weekly summary',
      '',
      'Opportunities tracked: ' + opps.length,
      'Queued for approval:   ' + count('queued_for_approval'),
      'Drafted (ready):       ' + count('drafted'),
      'Submitted / sent:      ' + (count('submitted') + count('sent')),
      'Responses:             ' + responses,
      'Interviews:            ' + interviews,
      '',
      'Target: 2-5 interviews/week.',
      interviews >= 2
        ? 'Status: on track.'
        : 'Status: below target - consider widening keywords/geo, adding ATS boards, or lowering SCORE_THRESHOLD in the Config tab.'
    ];

    const to = Session.getEffectiveUser().getEmail();
    GmailApp.createDraft(to, 'Job-Hunt - weekly summary', lines.join('\n'));
    Logger.log('weeklyReport: draft created for ' + to);
  }
};
