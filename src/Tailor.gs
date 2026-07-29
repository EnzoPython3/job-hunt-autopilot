/**
 * Tailor.gs - per-role CV + cover letter generation.
 *
 * CV: copies the master CV Google Doc (which must contain a {{SUMMARY}} token),
 * replaces the token with a Gemini-tailored, truthful summary, exports an
 * ATS-clean PDF into the Drive folder. Cover letter: a fresh Doc -> PDF.
 */
const Tailor = {
  operationKey_(opp, operation) {
    const id = String(opp && opp.id || '').trim();
    if (!id) throw new Error('Stable opportunity ID is required for ' + operation);
    return id.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120) + ':' + String(operation || '').replace(/[^A-Za-z0-9._:-]/g, '_');
  },

  storedFile_(id) {
    if (!id) return null;
    try {
      const file = DriveApp.getFileById(String(id));
      return { docUrl: file.getUrl(), pdfUrl: file.getUrl(), pdfId: String(id) };
    } catch (e) {
      return null;
    }
  },

  persist_(opp, values) {
    if (typeof Crm !== 'undefined' && Crm.updateRow && opp && opp._row) {
      Crm.updateRow(Crm.TABS.OPPORTUNITIES, opp._row, values);
    }
  },

  tailorCv(opp) {
    const existing = this.storedFile_(opp && opp.cv_file_id);
    if (existing) return existing;
    const masterId = Config.require(Config.KEYS.MASTER_CV_DOC_ID);
    const folder = this.folderForOpp_(opp);
    const cand = Config.promptCandidate();
    const operationKey = this.operationKey_(opp, 'cv');

    const summary = Gemini.generate(Prompts.render('cv_tailor', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role })
    }), { temperature: 0.4, maxOutputTokens: 400 }).trim();

    const baseName = 'CV - ' + cand.firstName + ' - ' + this.safe_(opp.company) + ' - ' + this.safe_(opp.role) + ' [' + operationKey + ']';
    const copyFile = DriveApp.getFileById(masterId).makeCopy(baseName, folder);
    const doc = DocumentApp.openById(copyFile.getId());
    doc.getBody().replaceText('\\{\\{SUMMARY\\}\\}', summary);
    doc.saveAndClose();

    const pdf = folder.createFile(DriveApp.getFileById(copyFile.getId()).getAs('application/pdf')).setName(baseName + '.pdf');
    this.persist_(opp, { cv_file_id: pdf.getId(), cv_pdf_url: pdf.getUrl(), failure_message: '' });
    return { docUrl: copyFile.getUrl(), pdfUrl: pdf.getUrl(), pdfId: pdf.getId(), summary: summary };
  },

  coverLetter(opp) {
    const existing = this.storedFile_(opp && opp.cover_file_id);
    if (existing) return existing;
    const folder = this.folderForOpp_(opp);
    const cand = Config.promptCandidate();
    const operationKey = this.operationKey_(opp, 'cover');

    const text = Gemini.generate(Prompts.render('cover_letter', {
      candidate: JSON.stringify(cand),
      job: JSON.stringify({ company: opp.company, role: opp.role, location: opp.location })
    }), { temperature: 0.5, maxOutputTokens: 700 }).trim();

    const name = 'Cover - ' + cand.firstName + ' - ' + this.safe_(opp.company) + ' - ' + this.safe_(opp.role) + ' [' + operationKey + ']';
    const doc = DocumentApp.create(name);
    doc.getBody().setText(text);
    doc.saveAndClose();
    const file = DriveApp.getFileById(doc.getId());
    file.moveTo(folder);
    const pdf = folder.createFile(file.getAs('application/pdf')).setName(name + '.pdf');
    this.persist_(opp, { cover_file_id: pdf.getId(), cover_url: pdf.getUrl(), failure_message: '' });
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
