/**
 * Tailor.gs - per-role CV + cover letter generation.
 *
 * CV: copies the master CV Google Doc (which must contain a {{SUMMARY}} token),
 * replaces the token with a Gemini-tailored, truthful summary, exports an
 * ATS-clean PDF into the Drive folder. Cover letter: a fresh Doc -> PDF.
 */
const Tailor = {
  tailorCv(opp) {
    const masterId = Config.require(Config.KEYS.MASTER_CV_DOC_ID);
    const folder = this.folderForOpp_(opp);
    const cand = Config.promptCandidate();

    const summary = Gemini.generate(Prompts.render('cv_tailor', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role })
    }), { temperature: 0.4, maxOutputTokens: 400 }).trim();

    const baseName = 'CV - ' + cand.firstName + ' - ' + this.safe_(opp.company) + ' - ' + this.safe_(opp.role);
    const copyFile = DriveApp.getFileById(masterId).makeCopy(baseName, folder);
    const doc = DocumentApp.openById(copyFile.getId());
    doc.getBody().replaceText('\\{\\{SUMMARY\\}\\}', summary);
    doc.saveAndClose();

    const pdf = folder.createFile(DriveApp.getFileById(copyFile.getId()).getAs('application/pdf')).setName(baseName + '.pdf');
    return { docUrl: copyFile.getUrl(), pdfUrl: pdf.getUrl(), pdfId: pdf.getId(), summary: summary };
  },

  coverLetter(opp) {
    const folder = this.folderForOpp_(opp);
    const cand = Config.promptCandidate();

    const text = Gemini.generate(Prompts.render('cover_letter', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role, location: opp.location })
    }), { temperature: 0.5, maxOutputTokens: 700 }).trim();

    const name = 'Cover - ' + cand.firstName + ' - ' + this.safe_(opp.company) + ' - ' + this.safe_(opp.role);
    const doc = DocumentApp.create(name);
    doc.getBody().setText(text);
    doc.saveAndClose();
    const file = DriveApp.getFileById(doc.getId());
    file.moveTo(folder);
    const pdf = folder.createFile(file.getAs('application/pdf')).setName(name + '.pdf');
    return { docUrl: file.getUrl(), pdfUrl: pdf.getUrl(), pdfId: pdf.getId(), text: text };
  },

  // Get-or-create a per-role subfolder named by company (fallback to role,
  // then "Unsorted") so each application's files live together.
  folderForOpp_(opp) {
    const root = DriveApp.getFolderById(Config.require(Config.KEYS.DRIVE_FOLDER_ID));
    let base = String(opp.company || '').trim();
    if (!base || base.toLowerCase() === 'unknown') base = String(opp.role || '').trim();
    const name = this.safe_(base) || 'Unsorted';
    const existing = root.getFoldersByName(name);
    return existing.hasNext() ? existing.next() : root.createFolder(name);
  },

  safe_(s) {
    return String(s || '').replace(/[^\w \-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
};
