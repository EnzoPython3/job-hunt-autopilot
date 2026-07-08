# Master CV template

Turn this into a **Google Doc** and set that Doc's ID as the `MASTER_CV_DOC_ID` Script
Property. The engine copies this Doc for every application and swaps the `{{SUMMARY}}` token
for a per-job tailored summary written by Gemini, then exports a PDF.

## Rules for the Doc
- **ATS-safe:** single column, no tables/text-boxes/images/headers-footers, standard fonts.
- Keep the literal token **`{{SUMMARY}}`** on its own where your professional summary goes.
  Do not style it or split it across lines - the engine replaces the exact text `{{SUMMARY}}`.
- Use only true facts. The prompts forbid inventing employers, dates or metrics.
- Do **not** put your salary anywhere in the CV.

---

# Your Full Name
City, Country | +00 00 000 0000 | you@example.com | linkedin.com/in/your-handle

## Professional summary
{{SUMMARY}}

## Skills
- Skill one, skill two, skill three
- Tools / systems you know (e.g. HubSpot, Zendesk, Excel)

## Experience

**Job Title - Company Name** | City | MMM YYYY - MMM YYYY
- What you did and the outcome (keep it factual and specific).
- Another responsibility or achievement.

**Job Title - Company Name** | City | MMM YYYY - MMM YYYY
- ...

## Education
**Qualification - Institution** | Year

## References
Available on request.
