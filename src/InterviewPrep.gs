/**
 * InterviewPrep.gs - when a role reaches status "interview", generate a
 * tailored prep pack (company brief, likely questions + angles, gap-handling,
 * questions to ask) as a Google Doc in the Drive folder.
 */
const InterviewPrep = {
  generateFor(opp) {
    const stableId = String(opp && opp.id || '').trim();
    if (!stableId) throw new Error('Stable opportunity ID is required for interview preparation');
    const markerPrefix = '[interview:' + stableId + ':interview:';
    const notes = String(opp.notes || '');
    const markerStart = notes.indexOf(markerPrefix);
    if (markerStart !== -1) {
      const markerEnd = notes.indexOf(']', markerStart);
      const marker = markerEnd === -1 ? notes.slice(markerStart) : notes.slice(markerStart, markerEnd + 1);
      const parts = marker.slice(markerPrefix.length, -1).split(':');
      if (parts.length >= 2 && parts[0]) return { docId: parts[0], docUrl: parts.slice(1).join(':') };
    }
    const folder = Tailor.folderForOpp_(opp);
    const cand = Config.promptCandidate();

    const text = Gemini.generate(Prompts.render('interview_prep', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role, location: opp.location })
    }), { temperature: 0.4, maxOutputTokens: 1400 }).trim();

    const operationKey = stableId + ':interview';
    const name = 'Interview Prep - ' + cand.firstName + ' - ' + Tailor.safe_(opp.company) + ' - ' + Tailor.safe_(opp.role) + ' [' + operationKey + ']';
    const doc = DocumentApp.create(name);
    doc.getBody().setText(text);
    doc.saveAndClose();
    const file = DriveApp.getFileById(doc.getId());
    const docUrl = file.getUrl();
    if (typeof Crm !== 'undefined' && Crm.updateRow && opp._row) {
      Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, {
        notes: (notes + ' [interview:' + operationKey + ':' + doc.getId() + ':' + docUrl + ']').trim(),
        failure_message: ''
      });
    }
    file.moveTo(folder);
    return { docId: doc.getId(), docUrl: docUrl };
  }
};
