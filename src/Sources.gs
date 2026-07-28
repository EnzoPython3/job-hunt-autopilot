/**
 * Sources.gs - job ingestion from compliant sources.
 * JSearch (RapidAPI, aggregates Google for Jobs: Indeed/LinkedIn/Glassdoor/PNet)
 * + Adzuna (official API) + public ATS JSON feeds (Greenhouse/Lever/Ashby/Workable).
 * Official APIs only - no scraping. Dedup by a stable content hash.
 * Adzuna's redirect links are validated (followed) at ingest and dead ones
 * dropped; JSearch and ATS return direct links, so they are trusted for speed.
 */
const Sources = {
  lastFailureReport_: [],
  MAX_RESPONSE_CHARS_: 200000,

  ingest(cap) {
    cap = cap || Config.tunable('DAILY_SOURCE_CAP');
    const self = this;
    const t0 = Date.now();
    const found = [];
    const failures = [];
    this.lastFailureReport_ = failures;
    this.failureContext_ = failures;
    try { Array.prototype.push.apply(found, this.fromJSearch_()); } catch (e) { this.recordFailure_(failures, 'JSearch'); }
    try { Array.prototype.push.apply(found, this.fromAdzuna()); } catch (e) { this.recordFailure_(failures, 'Adzuna'); }
    Config.atsBoards().forEach(function (b) {
      try { Array.prototype.push.apply(found, self.fromAts(b)); }
      catch (e) { self.recordFailure_(failures, 'ATS ' + b.type); }
    });
    this.failureContext_ = null;

    // Read existing ids ONCE. Calling Crm.existsOpportunity per job re-read the
    // whole sheet each time (quadratic, and worse as the sheet grows) - that plus
    // validating every link is what blew past the 6-minute execution limit.
    const seen = {};
    Crm.readAll(Crm.TABS.OPPORTUNITIES).forEach(function (o) { if (o.id) seen[o.id] = true; });

    const deadline = t0 + 5 * 60 * 1000;   // stop before Apps Script's 6-min hard kill
    let added = 0, dead = 0, excluded = 0, offloc = 0, stopped = false;
    for (let i = 0; i < found.length && added < cap; i++) {
      if (Date.now() > deadline) { stopped = true; break; }
      const job = found[i];
      if (!job.id || seen[job.id]) continue;
      seen[job.id] = true;   // also dedups within this run

      // Cheap string filters first - no network spent on jobs dropped anyway.
      if (!self.locationOk_(job)) { offloc++; continue; }

      // Adzuna hands out redirect links: resolve to the real employer URL (durable,
      // and exposes the true domain so the exclusion below can see it), drop dead
      // ones, and RE-KEY dedup on the resolved URL - Adzuna re-issues the same
      // posting under rotating redirect wrappers, so hashing the wrapper duplicated
      // rows. JSearch/ATS already return direct links.
      if (/^adzuna/.test(job.source)) {
        const r = self.resolveUrl_(job.url);
        if (!r.alive) { dead++; continue; }
        job.url = r.url;
        job.id = self.hashId_(job.source, job.company, job.role, job.url);
        if (seen[job.id]) continue;
        seen[job.id] = true;
      }

      if (self.isExcluded_(job)) { excluded++; continue; }

      // Best-effort application email from the posting text - turns a job into an
      // "email application" (tailored CV + Gmail draft) rather than a portal role.
      if (!job.contact_email && job.descr) job.contact_email = Outreach.harvestEmail_(job.descr);

      Crm.appendRow(Crm.TABS.OPPORTUNITIES, {
        id: job.id, source: job.source, company: job.company, role: job.role,
        location: job.location, mode: job.mode, url: job.url, contact_email: job.contact_email || '',
        posted_date: job.posted_date || '', status: 'sourced',
        created_at: new Date(), updated_at: new Date()
      });
      added++;
    }
    const skips = [];
    if (dead) skips.push(dead + ' dead-link');
    if (excluded) skips.push(excluded + ' excluded-board');
    if (offloc) skips.push(offloc + ' out-of-location');
    if (skips.length) Logger.log('ingest: skipped ' + skips.join(', ') + '.');
    if (stopped) Logger.log('ingest: stopped at time budget; next run continues with what is still fresh.');
    if (failures.length) {
      Logger.log('ingest: ' + failures.length + ' source failure(s); retry is required.');
      throw new Error('Source ingest failed: ' + failures.length + ' source failure(s)');
    }
    return added;
  },

  recordFailure_(failures, label) {
    failures = failures || this.failureContext_ || this.lastFailureReport_;
    if (failures.length >= 20) return;
    const entry = String(label) + ': source request failed';
    failures.push(entry);
    this.lastFailureReport_ = failures;
  },

  // Phrases boards print on a closed posting (many answer HTTP 200 for these).
  EXPIRED_RE: /no longer available|job (has )?expired|position (has )?been filled|this job is no longer/i,

  /**
   * Resolve a redirect URL (e.g. Adzuna's) to the final employer URL by following
   * Location headers AND meta-refresh redirects manually, so we can store the
   * direct link and see the true domain (the whatjobs/careers24 exclusion needs
   * it). Returns { url, alive }. The final page's body is checked for
   * expired-posting phrases - a closed role served with HTTP 200 counts as dead.
   * Fails open only after at least one hop resolved; an error on the very first
   * request marks the link dead (the job simply re-ingests on a later run).
   */
  resolveUrl_(url, maxHops) {
    url = Validation.safeHttpsUrl(url);
    if (!url) return { url: url, alive: false };
    maxHops = maxHops || 4;
    let cur = url;
    let hops = 0;
    try {
      for (let h = 0; h < maxHops; h++) {
        const res = UrlFetchApp.fetch(cur, {
          followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true
        });
        const code = res.getResponseCode();
        if (code >= 300 && code < 400) {
          const hdr = res.getAllHeaders();
          let loc = hdr['Location'] || hdr['location'];
          if (Array.isArray(loc)) loc = loc[0];
          if (!loc) return { url: cur, alive: true };
          cur = Validation.safeHttpsUrl(this.absoluteUrl_(cur, loc));
          if (!cur) return { url: '', alive: false };
          hops++;
          continue;
        }
        if (code >= 400) return { url: cur, alive: false };
        // 2xx - final page (or a meta-refresh interstitial).
        const body = res.getContentText().slice(0, 4000);
        if (this.EXPIRED_RE.test(body)) return { url: cur, alive: false };
        const meta = body.match(/http-equiv=["']?refresh["']?[^>]*url\s*=\s*["']?([^"'>\s]+)/i);
        if (meta && meta[1] && h < maxHops - 1) {
          cur = Validation.safeHttpsUrl(this.absoluteUrl_(cur, meta[1]));
          if (!cur) return { url: '', alive: false };
          hops++;
          continue;
        }
        return { url: cur, alive: true };
      }
      return { url: cur, alive: true };              // too many hops; treat as alive
    } catch (e) {
      Logger.log('resolveUrl_: request failed');
      return { url: cur, alive: hops > 0 };          // hop-0 failure = source link unreachable
    }
  },

  // Make a redirect target absolute against the current URL.
  absoluteUrl_(cur, loc) {
    loc = String(loc).trim();
    if (/^https?:\/\//i.test(loc)) return loc;
    const m = cur.match(/^(https?):\/\/([^\/]+)/);
    if (!m) return loc;
    if (loc.indexOf('//') === 0) return m[1] + ':' + loc;          // protocol-relative
    if (loc.charAt(0) === '/') return m[1] + '://' + m[2] + loc;   // root-relative
    const base = cur.replace(/[?#].*$/, '');                       // path-relative
    return base.indexOf('/', 8) === -1 ? (base + '/' + loc) : base.replace(/\/[^\/]*$/, '/') + loc;
  },

  // True if a job's board is on the exclusion list (checks source + resolved URL).
  isExcluded_(job) {
    const bl = Config.excludedDomains();
    if (!bl.length) return false;
    const hay = (String(job.source) + ' ' + String(job.url)).toLowerCase();
    for (let i = 0; i < bl.length; i++) if (hay.indexOf(bl[i]) !== -1) return true;
    return false;
  },

  isRemote_(job) {
    if (String(job.mode || '').toLowerCase() === 'remote') return true;
    return /\bremote\b|work from home|wfh/.test(String(job.location || '').toLowerCase());
  },

  // Location gate. Remote (globally) is always kept. Excluded areas are dropped even
  // if otherwise in range. A job with no readable location is kept (don't miss vague
  // opps). When an allow-list is set, a location must match it to be kept - EXCEPT
  // that a location which is nothing but a vague tag (a bare "Gauteng" or
  // "South Africa") also passes. A string naming a specific town outside the range
  // ("Mamelodi, Gauteng") does NOT ride the tag - the town itself must be allowed.
  locationOk_(job) {
    if (Config.allowRemote() && this.isRemote_(job)) return true;   // remote anywhere

    const loc = String(job.location || '').trim().toLowerCase();
    if (!loc) return true;                                     // no readable location -> keep (don't miss)

    const blocked = Config.excludedRegions();
    for (let i = 0; i < blocked.length; i++) if (loc.indexOf(blocked[i]) !== -1) return false;

    const allowed = Config.allowedRegions();
    if (!allowed.length) return true;                          // no allow-list -> keep the rest
    for (let j = 0; j < allowed.length; j++) if (loc.indexOf(allowed[j]) !== -1) return true;

    // Bare vague tags pass; anything left after stripping them names a town
    // outside the range -> drop.
    let rest = loc;
    Config.vagueLocationTags().forEach(function (t) { rest = rest.split(t).join(''); });
    return rest.replace(/[^a-z0-9]/g, '') === '';
  },

  /**
   * Follow a job URL and report whether it resolves to a live posting.
   * Treats HTTP >= 400 as dead, and Adzuna's "no longer available" landing
   * page as dead. Fails open (returns true) on network/timeout errors so a
   * transient blip does not silently drop a good job.
   */
  linkAlive_(url) {
    return this.resolveUrl_(url).alive;
  },

  hashId_(source, company, role, url) {
    const raw = [source, company, role, url].join('|').toLowerCase();
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
    const hex = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    return source.split(':')[0] + '_' + hex.slice(0, 16);
  },

  getJson_(url) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, validateHttpsCertificates: true });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    return JSON.parse(this.responseBody_(res));
  },

  responseBody_(res) {
    const body = String(res.getContentText() || '');
    if (body.length > this.MAX_RESPONSE_CHARS_) throw new Error('source response too large');
    return body;
  },

  fromAdzuna() {
    const appId = Config.get(Config.KEYS.ADZUNA_APP_ID);
    const appKey = Config.get(Config.KEYS.ADZUNA_APP_KEY) || Config.get('ADZUNA_API_KEY');
    if (!appId || !appKey) { Logger.log('Adzuna keys not set; skipping.'); return []; }
    const self = this;
    const out = [];
    Config.adzunaCountries().forEach(function (country) {
      Config.adzunaQueries().forEach(function (what) {
        const url = 'https://api.adzuna.com/v1/api/jobs/' + country + '/search/1' +
          '?app_id=' + encodeURIComponent(appId) +
          '&app_key=' + encodeURIComponent(appKey) +
          '&results_per_page=25' +
          '&what=' + encodeURIComponent(what) +
          '&sort_by=date' +          // newest first, so redirects are less likely expired
          '&max_days_old=10' +       // tighter window - stale postings 404 on click
          '&content-type=application/json';
        const label = 'Adzuna ' + country + '/' + what;
        try {
          const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, validateHttpsCertificates: true });
          if (res.getResponseCode() !== 200) { self.recordFailure_(null, label); return; }
          const data = JSON.parse(self.responseBody_(res));
          if (!data || !Array.isArray(data.results)) return;
          data.results.forEach(function (r) {
            if (!r || typeof r !== 'object') return;
            const company = (r.company && r.company.display_name) || 'Unknown';
            const role = r.title || '';
            const jurl = r.redirect_url || '';
            const valid = self.job_(
              'adzuna:' + country, company, role, jurl,
              (r.location && r.location.display_name) || '',
              /remote|work from home|wfh/.test((role + ' ' + (r.description || '')).toLowerCase()),
              r.created || '', r.description || ''
            );
            if (!valid) return;
            const hay = (role + ' ' + (r.description || '')).toLowerCase();
            valid.mode = /remote|work from home|wfh/.test(hay) ? 'remote' : '';
            out.push(valid);
          });
        } catch (e) { self.recordFailure_(null, label); }
      });
    });
    return out;
  },

  /**
   * JSearch (RapidAPI) - aggregates Google for Jobs, so one call covers
   * Indeed, LinkedIn, Glassdoor and SA boards (incl. PNet-sourced listings).
   * Returns DIRECT apply links (job_apply_link), so links are live by design.
   */
  fromJSearch_() {
    const key = Config.get(Config.KEYS.RAPIDAPI_KEY);
    if (!key) { Logger.log('JSearch key (RAPIDAPI_KEY) not set; skipping.'); return []; }
    const self = this;
    const out = [];
    const datePosted = Config.jsearchDatePosted();
    Config.jsearchQueries().forEach(function (what) {
      // JSearch's /search was retired in favour of /search-v2 (cursor pagination -
      // no page/num_pages). Omitting the cursor returns the first page, which is all we need.
      const url = 'https://jsearch.p.rapidapi.com/search-v2' +
        '?query=' + encodeURIComponent(what + ' in South Africa') +
        '&country=za' +
        '&date_posted=' + encodeURIComponent(datePosted);
      const label = 'JSearch ' + what;
      try {
        const res = UrlFetchApp.fetch(url, {
          method: 'get',
          muteHttpExceptions: true,
          headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
          validateHttpsCertificates: true
        });
        if (res.getResponseCode() !== 200) { self.recordFailure_(null, label); return; }
        const data = JSON.parse(self.responseBody_(res));
        self.pickJobs_(data).forEach(function (j) {
          if (!j || typeof j !== 'object') return;
          const company = j.employer_name || 'Unknown';
          const role = j.job_title || '';
          const jurl = j.job_apply_link || '';
          if (!jurl) return;
          const publisher = j.job_publisher || 'jsearch';
          const loc = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || (j.job_location || '');
          const valid = self.job_('jsearch:' + publisher, company, role, jurl, loc,
            j.job_is_remote, j.job_posted_at_datetime_utc || '', j.job_description || '');
          if (valid) out.push(valid);
        });
      } catch (e) { self.recordFailure_(null, label); }
    });
    return out;
  },

  /**
   * Find the jobs array in a JSearch response, tolerant of envelope changes.
   * /search returned { data: [...] }; /search-v2 (cursor) nests it, e.g.
   * { data: { jobs: [...], cursor } }. Returns [] if none of the shapes match.
   */
  pickJobs_(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    if (data.data && Array.isArray(data.data.jobs)) return data.data.jobs;
    if (Array.isArray(data.jobs)) return data.jobs;
    if (Array.isArray(data.results)) return data.results;
    return [];
  },

  fromAts(board) {
    switch (board.type) {
      case 'greenhouse': return this.fromGreenhouse_(board.slug);
      case 'lever': return this.fromLever_(board.slug);
      case 'ashby': return this.fromAshby_(board.slug);
      case 'workable': return this.fromWorkable_(board.slug);
      default: return [];
    }
  },

  fromGreenhouse_(slug) {
    const self = this;
    const data = this.getJson_('https://boards-api.greenhouse.io/v1/boards/' + slug + '/jobs');
    if (!data || !Array.isArray(data.jobs)) return [];
    return data.jobs.map(function (j) {
      return j && self.job_('greenhouse:' + slug, slug, j.title, j.absolute_url,
        j.location && j.location.name, false, j.updated_at || '', '');
    }).filter(Boolean);
  },

  fromLever_(slug) {
    const self = this;
    const data = this.getJson_('https://api.lever.co/v0/postings/' + slug + '?mode=json');
    if (!Array.isArray(data)) return [];
    return data.map(function (j) {
      const valid = j && self.job_('lever:' + slug, slug, j.text, j.hostedUrl,
        j.categories && j.categories.location, false, j.createdAt || '', '');
      if (valid) valid.mode = (j.categories && j.categories.commitment) || '';
      return valid;
    }).filter(Boolean);
  },

  fromAshby_(slug) {
    const self = this;
    const data = this.getJson_('https://api.ashbyhq.com/posting-api/job-board/' + slug + '?includeCompensation=false');
    if (!data || !Array.isArray(data.jobs)) return [];
    return data.jobs.map(function (j) {
      const valid = j && self.job_('ashby:' + slug, slug, j.title, j.jobUrl,
        j.location, j.isRemote, j.publishedAt || '', '');
      if (valid) valid.mode = j.isRemote ? 'remote' : '';
      return valid;
    }).filter(Boolean);
  },

  fromWorkable_(slug) {
    const self = this;
    const data = this.getJson_('https://apply.workable.com/api/v1/widget/accounts/' + slug + '?details=true');
    if (!data || !Array.isArray(data.jobs)) return [];
    return data.jobs.map(function (j) {
      if (!j || typeof j !== 'object') return null;
      const loc = j.location ? [j.location.city, j.location.country].filter(Boolean).join(', ') : '';
      const url = j.url || j.shortlink || '';
      const valid = self.job_('workable:' + slug, slug, j.title, url, loc,
        j.remote, j.published_on || '', '');
      if (valid) valid.mode = j.remote ? 'remote' : '';
      return valid;
    }).filter(Boolean);
  },

  job_(source, company, role, url, location, remote, postedDate, descr) {
    if (!url || !role) return null;
    const safeUrl = Validation.safeHttpsUrl(url);
    if (!safeUrl) return null;
    company = String(company || 'Unknown').slice(0, 200);
    role = String(role).trim().slice(0, 300);
    if (!role) return null;
    return {
      id: this.hashId_(source, company, role, safeUrl),
      source: source, company: company, role: role,
      location: String(location || '').slice(0, 300), mode: remote ? 'remote' : '',
      url: safeUrl, posted_date: String(postedDate || '').slice(0, 80),
      descr: String(descr || '').slice(0, 12000)
    };
  }
};
