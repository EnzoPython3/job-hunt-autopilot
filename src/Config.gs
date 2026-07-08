/**
 * Config.gs - central configuration and Script Properties access.
 *
 * Secrets and per-install IDs live in Script Properties
 * (Apps Script editor: Project Settings > Script Properties), never in source.
 * Tunable knobs live in the "Config" sheet tab and can be edited without a redeploy.
 */
const Config = {
  // --- Script Property keys ---
  KEYS: {
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_MODEL: 'GEMINI_MODEL',
    ADZUNA_APP_ID: 'ADZUNA_APP_ID',
    ADZUNA_APP_KEY: 'ADZUNA_APP_KEY',
    RAPIDAPI_KEY: 'RAPIDAPI_KEY',
    SHEET_ID: 'SHEET_ID',
    DRIVE_FOLDER_ID: 'DRIVE_FOLDER_ID',
    MASTER_CV_DOC_ID: 'MASTER_CV_DOC_ID',
    CANDIDATE_JSON: 'CANDIDATE_JSON'
  },

  props_() {
    return PropertiesService.getScriptProperties();
  },

  get(key, fallback) {
    const v = this.props_().getProperty(key);
    if (v === null || v === undefined) return fallback === undefined ? null : fallback;
    return v;
  },

  set(key, value) {
    this.props_().setProperty(key, String(value));
  },

  require(key) {
    const v = this.get(key);
    if (!v) throw new Error('Missing Script Property: ' + key + ' (set it in Project Settings > Script Properties).');
    return v;
  },

  // --- Safe defaults; override any of these via the "Config" sheet tab ---
  defaults: {
    GEMINI_MODEL: 'gemini-2.5-flash',
    SCORE_THRESHOLD: 62,       // minimum fit score (0-100) to queue for approval
    DAILY_SOURCE_CAP: 120,     // max new jobs ingested per day
    DAILY_APPROVAL_N: 25,      // max items pushed to the Approvals queue per day
    CHUNK_SIZE: 8,             // items processed per trigger run (respects the 6-min cap)
    AGENCY_DRAFTS_PER_RUN: 8,  // agency intro drafts created per run
    FOLLOWUP_DAYS: [3, 7]
  },

  /**
   * Read a tunable from the "Config" sheet tab, falling back to defaults.
   * Kept string/number tolerant so the sheet can hold either.
   */
  tunable(key) {
    try {
      const rows = Crm.readAll(Crm.TABS.CONFIG);
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].key === key && rows[i].value !== '' && rows[i].value !== null) {
          const n = Number(rows[i].value);
          return isNaN(n) ? rows[i].value : n;
        }
      }
    } catch (e) { /* sheet not ready yet - use default */ }
    return this.defaults[key];
  },

  // --- Candidate profile ---
  // EDIT THIS to yourself. The easiest, no-redeploy way is to paste a JSON version of the
  // object below into a Script Property named CANDIDATE_JSON (Project Settings > Script
  // Properties); if that property is set it wins and you can leave this default untouched.
  // The example below is a South-African customer-service jobseeker - swap in your details.
  candidate() {
    const raw = this.get(this.KEYS.CANDIDATE_JSON);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { Logger.log('Bad CANDIDATE_JSON: ' + e); }
    }
    return {
      name: 'Your Full Name',
      firstName: 'Your',
      email: 'you@example.com',
      phone: '+27 00 000 0000',
      location: 'City, Province, Country',
      linkedin: 'linkedin.com/in/your-handle',
      // --- Search targeting (kept as a working SA example; edit to your roles/regions) ---
      tracks: ['customer service', 'client support', 'contact centre', 'BPO', 'admin', 'office support'],
      geos: ['Johannesburg', 'Gauteng', 'South Africa', 'Remote'],
      remoteOk: true,
      internationalRemoteOk: true,
      salaryTargetNet: [0, 0], // net/month, currency of your country; INTERNAL ONLY - never printed on any output
      keywords: ['customer service', 'billing', 'account', 'retention', 'complaint resolution',
        'zendesk', 'hubspot', 'intercom', 'contact centre', 'call centre',
        'client support', 'administrative assistant', 'office administrator', 'data capture'],
      summary: 'One or two sentences describing who you are, your experience and the role you want. This feeds the fit-scoring and the tailored CV summary, so make it specific and factual.'
    };
  },

  /**
   * Public ATS job boards to poll. Add company board tokens here.
   * type: greenhouse | lever | ashby | workable ; slug: the board token in the URL.
   */
  atsBoards() {
    return [
      // { type: 'greenhouse', slug: 'examplecompany' },
      // { type: 'lever', slug: 'examplecompany' },
      // { type: 'ashby', slug: 'examplecompany' },
      // { type: 'workable', slug: 'examplecompany' }
    ];
  },

  // Adzuna country codes to search. za = South Africa; add 'gb' / 'us' for intl remote.
  adzunaCountries() {
    return ['za'];
  },

  // Adzuna "what" search terms, one request per term per country.
  adzunaQueries() {
    return ['customer service', 'call centre agent', 'client support', 'administrative assistant'];
  },

  // JSearch (RapidAPI) search terms, one request per term. " in South Africa"
  // is appended by the fetcher, so keep these role-only.
  jsearchQueries() {
    return this.adzunaQueries();
  },

  // JSearch freshness window: all | today | 3days | week | month.
  // 'week' keeps links fresh (and stays within the free-tier call budget).
  jsearchDatePosted() {
    return 'week';
  }
};
