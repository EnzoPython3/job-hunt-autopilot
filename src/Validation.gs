/**
 * Validation.gs - pure validation and normalisation helpers.
 *
 * These helpers deliberately have no Apps Script service or configuration
 * dependencies so they can be exercised safely in local Node tests.
 */
const Validation = {
  safeHttpsUrl(value) {
    if (typeof value !== 'string') return '';
    if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return '';

    const input = value.trim();
    if (!input) return '';

    try {
      const url = new URL(input);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
      return url.toString();
    } catch (e) {
      return '';
    }
  },

  safeHref(value) {
    const url = this.safeHttpsUrl(value);
    if (!url) return '';
    return url.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  isEmail(value) {
    if (typeof value !== 'string' || !value || value.length > 254) return false;
    if (/\s|[\u0000-\u001f\u007f]/.test(value)) return false;

    const at = value.lastIndexOf('@');
    if (at <= 0 || at !== value.indexOf('@') || at === value.length - 1) return false;
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (local.length > 64 || local.charAt(0) === '.' || local.charAt(local.length - 1) === '.' || local.indexOf('..') !== -1) return false;
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;

    const labels = domain.split('.');
    if (labels.length < 2 || labels.some(function (label) {
      return !label || label.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label);
    })) return false;
    return /^[A-Za-z]{2,63}$/.test(labels[labels.length - 1]);
  },

  requireArray(value, label) {
    if (!Array.isArray(value)) throw new Error(this.label_(label) + ' must be an array');
    return value;
  },

  requireObject(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(this.label_(label) + ' must be an object');
    }
    return value;
  },

  validateGeminiTextResponse(json) {
    const response = this.requireObject(json, 'Gemini response');
    const candidates = this.requireArray(response.candidates, 'Gemini response candidates');
    if (!candidates.length) throw new Error('Gemini response candidates must not be empty');

    const candidate = this.requireObject(candidates[0], 'Gemini candidate');
    const content = this.requireObject(candidate.content, 'Gemini candidate content');
    const parts = this.requireArray(content.parts, 'Gemini candidate parts');
    const text = parts.filter(function (part) {
      return part !== null && typeof part === 'object' && typeof part.text === 'string' && part.text.length > 0;
    }).map(function (part) { return part.text; }).join('');

    if (!text) throw new Error('Gemini candidate parts must contain text');
    return text;
  },

  label_(label) {
    const value = String(label === undefined || label === null ? 'value' : label).trim();
    return (value || 'value').slice(0, 64);
  }
};
