/**
 * Prompts.gs - single source of truth for all Gemini prompt templates.
 * Runtime uses these (clasp only pushes src/), so edit prompts HERE.
 * Substitution: {{name}} tokens are replaced by render(name, vars).
 *
 * House rules baked into every prompt: UK English, no fabrication, no em/en
 * dashes, never invent metrics/employers/dates, never state salary.
 */
const Prompts = {
  render(name, vars) {
    let t = this.templates[name];
    if (!t) throw new Error('Unknown prompt: ' + name);
    const v = vars || {};
    Object.keys(v).forEach(function (k) { t = t.split('{{' + k + '}}').join(String(v[k])); });
    return t;
  },

  templates: {
    scoring: [
      'You are a senior recruiter screening a job for a candidate. Return ONLY JSON matching the schema.',
      'fit_score: 0-100, how likely this candidate is to get an interview for this job.',
      'track: one of customer-service, admin, real-estate, mining, other.',
      'rationale: one honest sentence.',
      'matched_keywords / missing_keywords: from the candidate keyword list vs the role.',
      'Weigh relevance to the candidate tracks, seniority match, location/remote fit, and realistic interview odds.',
      'Do not inflate scores. A generic or senior/irrelevant role should score low.',
      '',
      'CANDIDATE:',
      '{{candidate}}',
      '',
      'JOB:',
      '{{job}}'
    ].join('\n'),

    cv_tailor: [
      'Write a tailored professional-summary paragraph (2-3 sentences) for this candidate applying to this specific job.',
      'Use ONLY facts present in the candidate profile. Do not invent metrics, tools, employers or achievements.',
      'UK English. No em or en dashes. No salary. Confident but truthful. Return plain text only, no heading.',
      '',
      'CANDIDATE:',
      '{{candidate}}',
      '',
      'JOB:',
      '{{job}}'
    ].join('\n'),

    cover_letter: [
      'Write a short, warm, professional cover letter (about 160-200 words) for this candidate applying to this job.',
      'Ground every claim in the candidate profile - no fabrication of metrics, tools, employers or dates.',
      'Structure: brief opening naming the role, 1-2 short paragraphs on relevant strengths, a confident close.',
      'UK English. No em or en dashes. Do not mention salary. Sign off with the candidate name.',
      'Return plain text only.',
      '',
      'CANDIDATE:',
      '{{candidate}}',
      '',
      'JOB:',
      '{{job}}'
    ].join('\n'),

    outreach: [
      'Write a short, personable application/introduction email BODY (about 90-130 words) from this candidate.',
      'Purpose: apply for or express interest in the role, and note that a CV is attached.',
      'Ground every claim in the candidate profile - no fabrication. UK English. No em or en dashes. No salary.',
      'Friendly and professional, not pushy. End with a clear, low-pressure call to action and the candidate name.',
      'Return plain text only (no subject line, no markdown).',
      '',
      'CANDIDATE:',
      '{{candidate}}',
      '',
      'ROLE / RECIPIENT:',
      '{{job}}'
    ].join('\n'),

    followup: [
      'Write a short, polite follow-up email BODY (about 60-90 words) from this candidate,',
      'sent {{stage}} after applying for the role, gently checking on the status and reaffirming interest.',
      'Ground every claim in the candidate profile - no fabrication. UK English. No em or en dashes. No salary.',
      'Warm, brief, not pushy. End with the candidate name. Return plain text only.',
      '',
      'CANDIDATE:',
      '{{candidate}}',
      '',
      'ROLE:',
      '{{job}}'
    ].join('\n'),

    interview_prep: [
      'You are a senior interview coach. For this candidate and this specific company/role, produce a concise prep pack.',
      'Include: (1) a 3-line company/role brief, (2) 6 likely interview questions, (3) for each, a one-line angle grounded in the candidate profile, (4) a 2-line honest gap-handling note, (5) 3 questions the candidate should ask.',
      'UK English. No em or en dashes. No fabrication. No salary figures. Return plain text.',
      '',
      'CANDIDATE:',
      '{{candidate}}',
      '',
      'JOB:',
      '{{job}}'
    ].join('\n')
  }
};
