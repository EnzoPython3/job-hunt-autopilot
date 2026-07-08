/**
 * Triggers.gs - install/remove the time-driven triggers (the "loop").
 * Run installTriggers() once after setup.
 */
function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('dailySource').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('scoreQueue').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('prepApprovedBatch').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('morningDigest').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('followUps').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('prepInterviews').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  // Auto-stamp applied_date when you pick sent/submitted in the status dropdown.
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(Config.require(Config.KEYS.SHEET_ID)).onEdit().create();
  Logger.log('Triggers installed.');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Existing triggers removed.');
}
