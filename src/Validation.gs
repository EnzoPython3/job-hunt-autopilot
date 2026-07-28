/**
 * Validation.gs - pure validation and normalisation helpers.
 *
 * These helpers deliberately have no Apps Script service or configuration
 * dependencies so they can be exercised safely in local Node tests.
 */
const Validation = {
  safeHttpsUrl(value) {
    if (typeof value !== 'string') return '';
    if (!value || value.length > 4096 || /[\s\u0000-\u001f\u007f-\u009f\\]/.test(value)) return '';

    const schemeEnd = value.indexOf('://');
    if (schemeEnd <= 0 || value.slice(0, schemeEnd).toLowerCase() !== 'https') return '';

    const remainder = value.slice(schemeEnd + 3);
    const authorityEnd = remainder.search(/[/?#]/);
    const authority = authorityEnd === -1 ? remainder : remainder.slice(0, authorityEnd);
    if (!authority) return '';

    const host = this.parseHost_(authority);
    if (!host) return '';

    try {
      const suffix = authorityEnd === -1 ? '' : remainder.slice(authorityEnd);
      const normalisedSuffix = this.normaliseSuffix_(suffix);
      if (!normalisedSuffix) return '';
      return 'https://' + host + normalisedSuffix;
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

  parseHost_(authority) {
    if (authority.indexOf('@') !== -1) return '';

    let host = authority;
    let port = '';
    if (authority.charAt(0) === '[') {
      const close = authority.indexOf(']');
      if (close < 2) return '';
      host = authority.slice(0, close + 1);
      const address = host.slice(1, -1);
      if (!this.validIpv6_(address)) return '';
      if (authority.length > close + 1) {
        if (authority.charAt(close + 1) !== ':') return '';
        port = authority.slice(close + 2);
      }
    } else {
      const colon = authority.lastIndexOf(':');
      if (colon !== -1) {
        host = authority.slice(0, colon);
        port = authority.slice(colon + 1);
      }
      if (!this.validHostname_(host)) return '';
    }

    if (port) {
      if (!/^\d{1,5}$/.test(port)) return '';
      const number = Number(port);
      if (number < 1 || number > 65535) return '';
      if (number !== 443) port = ':' + number;
      else port = '';
    } else if (authority.charAt(authority.length - 1) === ':') {
      return '';
    }
    return host.toLowerCase() + port;
  },

  validHostname_(host) {
    if (!host || host.length > 253 || host.indexOf('..') !== -1) return false;
    if (/^\d+(?:\.\d+)+$/.test(host)) return this.parseIpv4_(host) !== null;
    const labels = host.split('.');
    for (let i = 0; i < labels.length; i++) {
      if (!labels[i] || labels[i].length > 63 ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(labels[i])) return false;
    }
    return true;
  },

  parseIpv4_(value) {
    if (!/^\d+(?:\.\d+){3}$/.test(value)) return null;
    const octets = value.split('.');
    for (let i = 0; i < octets.length; i++) {
      if (octets[i].length > 3) return null;
      const number = Number(octets[i]);
      if (number < 0 || number > 255) return null;
      octets[i] = String(number);
    }
    return octets;
  },

  validIpv6_(address) {
    if (!address || address.indexOf(':::') !== -1) return false;
    const dotted = address.indexOf('.') !== -1;
    if (dotted) {
      const colon = address.lastIndexOf(':');
      if (colon === -1) return false;
      const octets = this.parseIpv4_(address.slice(colon + 1));
      if (!octets) return false;
      const high = ((Number(octets[0]) * 256) + Number(octets[1])).toString(16);
      const low = ((Number(octets[2]) * 256) + Number(octets[3])).toString(16);
      address = address.slice(0, colon + 1) + high + ':' + low;
    }
    const compression = address.indexOf('::');
    if (compression !== -1 && compression !== address.lastIndexOf('::')) return false;

    const validGroups = function (side) {
      if (!side) return [];
      const groups = side.split(':');
      for (let i = 0; i < groups.length; i++) {
        if (!/^[0-9A-Fa-f]{1,4}$/.test(groups[i])) return null;
      }
      return groups;
    };

    if (compression === -1) {
      const groups = validGroups(address);
      return groups !== null && groups.length === 8;
    }

    const left = validGroups(address.slice(0, compression));
    const right = validGroups(address.slice(compression + 2));
    if (left === null || right === null) return false;
    return left.length + right.length < 8;
  },

  normaliseSuffix_(suffix) {
    if (!suffix) return '/';
    const marker = suffix.search(/[?#]/);
    const path = marker === -1 ? suffix : suffix.slice(0, marker);
    const tail = marker === -1 ? '' : this.escapeUrlChars_(suffix.slice(marker));
    if (path && path.charAt(0) !== '/') return '';

    const segments = (path || '/').split('/');
    const normalised = [];
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === '.') continue;
      if (segments[i] === '..') {
        if (normalised.length > 1) normalised.pop();
        continue;
      }
      normalised.push(this.escapeUrlChars_(segments[i]));
    }
    let result = normalised.join('/');
    if (!result || result.charAt(0) !== '/') result = '/' + result;
    return result + tail;
  },

  escapeUrlChars_(value) {
    return value.replace(/[<>"']/g, function (character) {
      return '%' + character.charCodeAt(0).toString(16).toUpperCase();
    });
  },

  label_(label) {
    const value = String(label === undefined || label === null ? 'value' : label).trim();
    return (value || 'value').slice(0, 64);
  }
};
