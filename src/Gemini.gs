/**
 * Gemini.gs - thin wrapper over the Gemini generateContent REST API.
 * Called from GAS via UrlFetchApp. The API key lives in Script Properties.
 */
const Gemini = {
  endpoint_(model) {
    return 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent';
  },

  /**
   * Generate text (or structured JSON) from a prompt.
   * opts: { json:boolean, schema:object, temperature:number, maxOutputTokens:number, system:string }
   * Returns a string, or (when opts.json) a parsed object.
   */
  generate(prompt, opts) {
    opts = opts || {};
    const key = Config.require(Config.KEYS.GEMINI_API_KEY);
    const model = Config.get(Config.KEYS.GEMINI_MODEL) || Config.defaults.GEMINI_MODEL;
    const url = this.endpoint_(model) + '?key=' + encodeURIComponent(key);

    const genConfig = {
      temperature: opts.temperature == null ? 0.3 : opts.temperature,
      maxOutputTokens: opts.maxOutputTokens || 2048,
      // Gemini 2.5+ models spend output budget on hidden "thinking" tokens,
      // which truncates short answers. Our tasks are classification / short
      // generation, so disable thinking by default. Override with opts.thinkingBudget.
      thinkingConfig: { thinkingBudget: opts.thinkingBudget == null ? 0 : opts.thinkingBudget }
    };
    if (opts.json) {
      genConfig.responseMimeType = 'application/json';
      if (opts.schema) genConfig.responseSchema = opts.schema;
    }

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: genConfig
    };
    if (opts.system) payload.systemInstruction = { parts: [{ text: opts.system }] };

    const text = this.fetchWithRetry_(url, payload);
    if (opts.json) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error('Gemini did not return valid JSON: ' + e + ' :: ' + String(text).slice(0, 300)); }
    }
    return text;
  },

  fetchWithRetry_(url, payload) {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    let lastErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      const body = res.getContentText();
      if (code === 200) return this.extractText_(JSON.parse(body));
      lastErr = 'HTTP ' + code + ': ' + String(body).slice(0, 300);
      if (code === 429 || code >= 500) {
        Utilities.sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
      break; // non-retryable
    }
    throw new Error('Gemini request failed: ' + lastErr);
  },

  extractText_(json) {
    const cand = json && json.candidates && json.candidates[0];
    if (!cand) {
      const fb = json && json.promptFeedback ? JSON.stringify(json.promptFeedback) : '';
      throw new Error('Gemini returned no candidates. ' + fb);
    }
    const parts = cand.content && cand.content.parts;
    if (!parts || !parts.length) throw new Error('Gemini candidate had no parts.');
    return parts.map(function (p) { return p.text || ''; }).join('');
  }
};
