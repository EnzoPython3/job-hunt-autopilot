/**
 * MasterCv.gs - build a clean, ATS-safe master CV Google Doc from scratch.
 *
 * Run buildMasterCv() ONCE. It creates a single-column, standard-font Doc with
 * bold section headers, section rules and real bullet lists (all ATS-parseable -
 * no tables, columns, images or text boxes), containing a {{SUMMARY}} token, then
 * points MASTER_CV_DOC_ID at it so tailorCv() copies this Doc per role.
 *
 * This is a starter: it fills your name/contact/skills from your profile and adds
 * PLACEHOLDER experience/education. Open the generated Doc and replace the
 * placeholders with your real history (keep it single-column, keep {{SUMMARY}}),
 * or edit masterCvContent_() and re-run. Nothing here is sent until you approve.
 */

function buildMasterCv() {
  const c = masterCvContent_();
  const FONT = 'Arial';
  const DARK = '#222222';
  const MUTE = '#666666';

  const doc = DocumentApp.create('Master CV - ' + c.name);
  const body = doc.getBody();
  body.setMarginTop(50).setMarginBottom(50).setMarginLeft(56).setMarginRight(56);

  function styleP(p, o) {
    const a = {};
    a[DocumentApp.Attribute.FONT_FAMILY] = FONT;
    a[DocumentApp.Attribute.FONT_SIZE] = o.size || 10;
    a[DocumentApp.Attribute.BOLD] = !!o.bold;
    a[DocumentApp.Attribute.ITALIC] = !!o.italic;
    a[DocumentApp.Attribute.FOREGROUND_COLOR] = o.color || DARK;
    p.setAttributes(a);
    if (o.before != null) p.setSpacingBefore(o.before);
    if (o.after != null) p.setSpacingAfter(o.after);
    return p;
  }
  function para(text, o) { return styleP(body.appendParagraph(text), o || {}); }
  function bullet(text, o) {
    const li = body.appendListItem(text).setGlyphType(DocumentApp.GlyphType.BULLET);
    return styleP(li, o || {});
  }
  function section(title) {
    para(title.toUpperCase(), { size: 11, bold: true, color: DARK, before: 12, after: 4 });
    body.appendHorizontalRule();
  }

  para(c.name, { size: 20, bold: true, after: 2 });
  para(c.title, { size: 12, color: MUTE, after: 6 });
  para(c.contact, { size: 10, color: MUTE, after: 1 });
  para('Languages: ' + c.languages, { size: 10, color: MUTE, after: 6 });

  section('Professional Summary');
  para('{{SUMMARY}}', { size: 10, after: 4 });

  section('Key Skills');
  para(c.skills, { size: 10, after: 4 });

  section('Professional Experience');
  c.experience.forEach(function (job, i) {
    const head = job.company ? (job.role + ' - ' + job.company) : job.role;
    para(head, { size: 11, bold: true, before: i ? 8 : 2, after: 0 });
    para(job.dates + '  ·  ' + job.location, { size: 9, italic: true, color: MUTE, after: 2 });
    job.bullets.forEach(function (b) { bullet(b, { size: 10, after: 1 }); });
  });

  section('Education & Certifications');
  c.education.forEach(function (e) { bullet(e, { size: 10, after: 1 }); });

  section('Tools & Systems');
  para(c.tools, { size: 10, after: 2 });

  const first = body.getChild(0);
  if (first.getType() === DocumentApp.ElementType.PARAGRAPH && first.asParagraph().getText() === '') {
    first.asParagraph().removeFromParent();
  }
  doc.saveAndClose();

  const folderId = Config.get(Config.KEYS.DRIVE_FOLDER_ID);
  if (folderId) { try { DriveApp.getFileById(doc.getId()).moveTo(DriveApp.getFolderById(folderId)); } catch (e) { /* ignore */ } }
  Config.set(Config.KEYS.MASTER_CV_DOC_ID, doc.getId());

  Logger.log('Master CV built: ' + doc.getUrl() + '\nMASTER_CV_DOC_ID set. Replace the PLACEHOLDER experience with your real history, keeping {{SUMMARY}}.');
  return doc.getUrl();
}

/**
 * CV content. Name/contact/skills come from your profile (Config.candidate());
 * experience/education are PLACEHOLDERS to replace with your real history. Keep it
 * strictly truthful and plain text - buildMasterCv() applies the ATS-safe layout.
 */
function masterCvContent_() {
  const c = Config.candidate();
  const contact = [c.location, c.phone, c.email, c.linkedin].filter(Boolean).join(' | ');
  const skills = (c.keywords && c.keywords.length)
    ? c.keywords.map(function (k) { return k.charAt(0).toUpperCase() + k.slice(1); }).join(' · ')
    : 'List your key skills here, separated by middots.';
  return {
    name: c.name || 'Your Full Name',
    title: 'Your Professional Title',
    contact: contact || 'City, Country | +00 00 000 0000 | you@example.com | linkedin.com/in/your-handle',
    languages: 'English',
    skills: skills,
    experience: [
      {
        role: 'Most Recent Job Title', company: 'Company Name',
        dates: 'MMM YYYY - Present', location: 'City',
        bullets: [
          'Replace with a real responsibility and its outcome (factual and specific).',
          'Add another achievement - use numbers where you honestly can.',
          'Keep three to five bullets per role.'
        ]
      },
      {
        role: 'Previous Job Title', company: 'Company Name',
        dates: 'MMM YYYY - MMM YYYY', location: 'City',
        bullets: [
          'What you did and the result.',
          'Another responsibility or achievement.'
        ]
      }
    ],
    education: [
      'Qualification - Institution, Year',
      'Certification - Provider'
    ],
    tools: 'List the tools and systems you know, separated by middots.'
  };
}
