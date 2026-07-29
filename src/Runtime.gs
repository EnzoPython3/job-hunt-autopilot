/**
 * Runtime.gs - shared execution guards for scheduled workflows.
 *
 * These helpers deliberately depend only on Apps Script's LockService and
 * standard JavaScript primitives so they are easy to exercise locally.
 */
const Runtime = {
  withScriptLock(name, waitMs, fn) {
    if (typeof fn !== 'function') throw new Error('Lock callback is required');
    const lock = LockService.getScriptLock();
    const wait = this.boundedBatch(waitMs, 0, 300000);
    let acquired = false;
    try {
      acquired = lock.tryLock(wait);
      if (!acquired) throw new Error('Could not acquire script lock: ' + String(name || 'unnamed'));
      return fn();
    } finally {
      if (acquired) lock.releaseLock();
    }
  },

  deadlineMs(limitMs) {
    const limit = this.boundedBatch(limitMs, 270000, 330000);
    return Date.now() + limit;
  },

  shouldStop(deadline) {
    return deadline !== null && deadline !== undefined && Date.now() >= Number(deadline);
  },

  boundedBatch(value, fallback, maximum) {
    const safeFallback = Math.max(1, Math.floor(Number(fallback)) || 1);
    const safeMaximum = Math.max(1, Math.floor(Number(maximum)) || safeFallback);
    const numeric = Number(value);
    if (!isFinite(numeric) || numeric <= 0) return Math.min(safeFallback, safeMaximum);
    return Math.min(Math.max(1, Math.floor(numeric)), safeMaximum);
  },

  failure(name, error) {
    let message = '';
    try { message = String(error && error.message ? error.message : error || 'Unknown failure'); } catch (e) { message = 'Unknown failure'; }
    message = message.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (message.length > 240) message = message.slice(0, 237) + '...';
    return { name: String(name || 'unknown'), message: message || 'Unknown failure' };
  }
};
