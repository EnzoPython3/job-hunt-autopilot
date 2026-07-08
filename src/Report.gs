/**
 * Report.gs - weekly KPI + funnel summary.
 * Appends (or refreshes) this week's row on the KPIs tab AND creates a Gmail
 * DRAFT to the script owner. Nothing auto-sends, per the Assisted guardrail.
 * KPI figures are running totals from the Opportunities/Approvals tabs, so the
 * KPIs tab reads as a week-over-week trend (one row per Monday).
 */
const Report = {
  sendWeekly() {
    const opps = Crm.readAll(Crm.TABS.OPPORTUNITIES);
    const apprs = Crm.readAll(Crm.TABS.APPROVALS);
    const count = function (s) { return opps.filter(function (o) { return o.status === s; }).length; };
    const withVal = function (f) { return opps.filter(function (o) { return String(o[f] || '').trim() !== ''; }).length; };

    const kpi = {
      sourced: opps.length,
      scored: opps.filter(function (o) { return String(o.fit_score || '').trim() !== '' && !isNaN(Number(o.fit_score)); }).length,
      queued: apprs.length,                                       // reached the review queue
      approved: apprs.filter(function (a) { return String(a.decision || '').trim().toLowerCase() === 'approve'; }).length,
      submitted: withVal('applied_date'),                         // you marked it sent/submitted
      sent: withVal('outreach_draft_url'),                        // an outreach draft was created
      responses: withVal('response'),
      interviews: opps.filter(function (o) {
        return String(o.interview_date || '').trim() !== '' || o.status === 'interview' || o.status === 'offer';
      }).length
    };

    this.writeKpiRow_(kpi);

    const lines = [
      'Job-Hunt - weekly summary',
      '',
      'Opportunities tracked: ' + kpi.sourced,
      'Queued for approval:   ' + count('queued_for_approval'),
      'Drafted (ready):       ' + count('drafted'),
      'Submitted / sent:      ' + (count('submitted') + count('sent')),
      'Responses:             ' + kpi.responses,
      'Interviews:            ' + kpi.interviews,
      '',
      'Full funnel is on the KPIs tab (one row per week).',
      'Target: 2-5 interviews/week.',
      kpi.interviews >= 2
        ? 'Status: on track.'
        : 'Status: below target - consider widening keywords/geo, adding ATS boards, or lowering SCORE_THRESHOLD in the Config tab.'
    ];

    const to = Session.getEffectiveUser().getEmail();
    GmailApp.createDraft(to, 'Job-Hunt - weekly summary', lines.join('\n'));
    Logger.log('weeklyReport: KPIs row written + draft created for ' + to);
  },

  // Write this week's funnel to the KPIs tab; refresh the row if one already
  // exists for this week's Monday, so re-running does not create duplicates.
  writeKpiRow_(kpi) {
    const week = Utilities.formatDate(this.mondayOf_(new Date()), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const row = {
      week_start: week, sourced: kpi.sourced, scored: kpi.scored, queued: kpi.queued,
      approved: kpi.approved, submitted: kpi.submitted, sent: kpi.sent,
      responses: kpi.responses, interviews: kpi.interviews, notes: 'auto weekly snapshot'
    };
    const existing = Crm.readAll(Crm.TABS.KPIS).filter(function (r) {
      const w = (r.week_start instanceof Date)
        ? Utilities.formatDate(r.week_start, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.week_start).slice(0, 10);
      return w === week;
    })[0];
    if (existing) Crm.updateRow(Crm.TABS.KPIS, existing._row, row);
    else Crm.appendRow(Crm.TABS.KPIS, row);
  },

  mondayOf_(d) {
    const day = d.getDay();                       // 0=Sun .. 6=Sat
    const back = (day === 0 ? -6 : 1 - day);      // days back to Monday
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + back);
  }
};
