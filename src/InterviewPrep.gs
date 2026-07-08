/**
 * InterviewPrep.gs - when a role reaches status "interview", generate a
 * tailored prep pack (company brief, likely questions + angles, gap-handling,
 * questions to ask) as a Google Doc in the Drive folder.
 */
const InterviewPrep = {
  generateFor(opp) {
    const folder = Tailor.folderForOpp_(opp);
    const cand = Config.candidate();

    const text = Gemini.generate(Prompts.render('interview_prep', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role, location: opp.location })
    }), { temperature: 0.4, maxOutputTokens: 1400 }).trim();

    const name = 'Interview Prep - ' + cand.firstName + ' - ' + Tailor.safe_(opp.company) + ' - ' + Tailor.safe_(opp.role);
    const doc = DocumentApp.create(name);
    doc.getBody().setText(text);
    doc.saveAndClose();
    const file = DriveApp.getFileById(doc.getId());
    file.moveTo(folder);
    return { docUrl: file.getUrl() };
  }
};
