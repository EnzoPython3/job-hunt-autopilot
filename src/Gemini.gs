/**
 * Gemini.gs - thin wrapper over the Gemini generateContent REST API.
 * Called from GAS via UrlFetchApp. The API key lives in Script Properties.
 */
const Gemini = {
  RETRY_COUNT: 3,

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
    const url = this.endpoint_(model);

    const buildPayload_ = function (includeThinkingConfig) {
      const genConfig = {
        temperature: opts.temperature == null ? 0.3 : opts.temperature,
        maxOutputTokens: opts.maxOutputTokens || 2048
      };
      if (includeThinkingConfig) {
        // Gemini 2.5 spends output budget on hidden "thinking" tokens, which
        // truncates short answers, so we disable it by default. Newer model
        // generations (e.g. Gemini 3.x, reached via the gemini-flash-latest
        // alias) reject a literal 0 budget instead of accepting it as "off" -
        // rather than hardcode per-model-generation support, generate() below
        // retries once with this block omitted if the first attempt 400s.
        genConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget == null ? 0 : opts.thinkingBudget };
      }
      if (opts.json) {
        genConfig.responseMimeType = 'application/json';
        if (opts.schema) genConfig.responseSchema = opts.schema;
      }
      const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: genConfig
      };
      if (opts.system) payload.systemInstruction = { parts: [{ text: opts.system }] };
      return payload;
    };

    let text;
    try {
      text = this.fetchWithRetry_(url, buildPayload_(true), opts.retryCount);
    } catch (e) {
      if (e && e.unsupportedThinkingConfig) {
        text = this.fetchWithRetry_(url, buildPayload_(false), opts.retryCount);
      } else {
        throw e;
      }
    }
    if (opts.json) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error('Gemini did not return valid JSON'); }
    }
    return text;
  },

  fetchWithRetry_(url, payload, configuredRetries) {
    let retries = configuredRetries == null ? this.RETRY_COUNT : Number(configuredRetries);
    if (!isFinite(retries) || retries < 0) retries = this.RETRY_COUNT;
    retries = Math.min(Math.floor(retries), this.RETRY_COUNT);
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: { 'x-goog-api-key': Config.require(Config.KEYS.GEMINI_API_KEY) },
      muteHttpExceptions: true
    };
    let lastCode = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      const body = res.getContentText();
      if (code === 200) {
        let json;
        try { json = JSON.parse(body); }
        catch (e) { throw new Error('Gemini returned invalid response'); }
        return this.extractText_(json);
      }
      lastCode = code;
      if (code === 400 && this.isUnsupportedThinkingConfigError_(body)) {
        const thinkingError = new Error('Gemini request failed: HTTP 400');
        thinkingError.unsupportedThinkingConfig = true;
        throw thinkingError;
      }
      if ((code === 429 || code >= 500) && attempt < retries) {
        Utilities.sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
      break;
    }
    throw new Error('Gemini request failed: HTTP ' + lastCode);
  },

  extractText_(json) {
    return Validation.validateGeminiTextResponse(json);
  },

  isUnsupportedThinkingConfigError_(body) {
    let json;
    try { json = JSON.parse(body); } catch (e) { return false; }
    const error = json && json.error;
    const message = error && typeof error.message === 'string' ? error.message : '';
    return /thinkingConfig/i.test(message) &&
      /(unsupported|not supported|unknown(?: field| name)?|unrecognised|unrecognized)/i.test(message);
  }
};
