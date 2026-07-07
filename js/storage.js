const POS_CACHE_TTL = {
  DB_DATA: 24 * 60 * 60 * 1000,
  DB_MANIFEST: 24 * 60 * 60 * 1000,
  WIKI_RESULT: 24 * 60 * 60 * 1000
};

const POS_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525]);

function posCacheIsFresh(entry, ttl) {
  return Boolean(entry && entry.updatedAt && Date.now() - entry.updatedAt < ttl);
}

function posStorageAvailable() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

function posStorageGet(key) {
  if (!posStorageAvailable()) return Promise.resolve(null);

  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(result ? result[key] : null);
    });
  });
}

function posStorageSet(key, value) {
  if (!posStorageAvailable()) return Promise.resolve(false);

  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

function posWait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function posFetchWithRetry(url, options = {}, attempts = 2, delayMs = 300) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;

      lastError = new Error(`HTTP ${res.status}`);
      lastError.status = res.status;

      if (!POS_RETRY_STATUSES.has(res.status) || attempt === attempts) {
        throw lastError;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      lastError = err;

      if (attempt === attempts) throw err;
    }

    await posWait(delayMs * attempt);
  }

  throw lastError || new Error('Fetch failed');
}
