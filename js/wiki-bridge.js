(() => {
  if (globalThis.__POS_WIKI_BRIDGE_INSTALLED__) return;
  globalThis.__POS_WIKI_BRIDGE_INSTALLED__ = true;

  const INDEX_VERSION = 1;
  const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
  let indexSyncPromise = null;

  function currentGame() {
    return location.hostname === 'www.poe2wiki.net' ? 'poe2' : 'poe';
  }

  function indexKey(game = currentGame()) {
    return `pos:wiki-index:${game}:v${INDEX_VERSION}`;
  }

  function storageGet(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => resolve(result?.[key] || null));
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        const err = chrome.runtime?.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  function mapOpenSearch(data) {
    return Array.isArray(data?.[1])
      ? data[1].map(label => ({ label, value: label }))
      : [];
  }

  function mapPrefixSearch(data) {
    return Array.isArray(data?.query?.prefixsearch)
      ? data.query.prefixsearch.map(item => ({ label: item.title, value: item.title }))
      : [];
  }

  function mapFullTextSearch(data) {
    return Array.isArray(data?.query?.search)
      ? data.query.search.map(item => ({ label: item.title, value: item.title }))
      : [];
  }

  async function fetchJson(path, params) {
    const url = `${location.origin}${path}?${params.toString()}`;
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json, text/plain, */*' }
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();

    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    if (contentType.includes('text/html') || /anubis/i.test(text)) {
      throw new Error('ANUBIS_CHALLENGE');
    }

    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('INVALID_JSON');
    }
  }

  async function callApi(params) {
    let lastError = null;
    for (const path of ['/api.php', '/w/api.php']) {
      try {
        return await fetchJson(path, params);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('WIKI_API_FAILED');
  }

  async function searchWiki(query, limit) {
    const openParams = new URLSearchParams({
      action: 'opensearch',
      search: query,
      limit: String(limit),
      namespace: '0',
      format: 'json'
    });
    try {
      const items = mapOpenSearch(await callApi(openParams));
      if (items.length) return items;
    } catch (_) {}

    const prefixParams = new URLSearchParams({
      action: 'query',
      list: 'prefixsearch',
      pssearch: query,
      pslimit: String(limit),
      format: 'json'
    });
    try {
      const items = mapPrefixSearch(await callApi(prefixParams));
      if (items.length) return items;
    } catch (_) {}

    const fullParams = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(limit),
      srnamespace: '0',
      format: 'json'
    });
    return mapFullTextSearch(await callApi(fullParams));
  }

  async function syncWikiTitleIndex(force = false) {
    if (indexSyncPromise) return indexSyncPromise;

    indexSyncPromise = (async () => {
      const game = currentGame();
      const key = indexKey(game);
      const existing = await storageGet(key);

      if (!force && existing?.updatedAt && Array.isArray(existing?.titles) && existing.titles.length) {
        if (Date.now() - existing.updatedAt < INDEX_TTL_MS) return existing;
      }

      const titles = [];
      let apcontinue = null;
      let pageCount = 0;

      do {
        const params = new URLSearchParams({
          action: 'query',
          list: 'allpages',
          apnamespace: '0',
          aplimit: 'max',
          format: 'json'
        });
        if (apcontinue) params.set('apcontinue', apcontinue);

        const data = await callApi(params);
        const pages = Array.isArray(data?.query?.allpages) ? data.query.allpages : [];
        for (const page of pages) {
          if (page?.title) titles.push(page.title);
        }

        apcontinue = data?.continue?.apcontinue || null;
        pageCount += 1;

        // Safety guard against a malformed continuation loop.
        if (pageCount > 250) throw new Error('INDEX_CONTINUATION_LIMIT');
      } while (apcontinue);

      const uniqueTitles = [...new Set(titles)];
      const payload = {
        updatedAt: Date.now(),
        game,
        source: location.hostname,
        count: uniqueTitles.length,
        titles: uniqueTitles
      };

      await storageSet(key, payload);
      return payload;
    })();

    try {
      return await indexSyncPromise;
    } finally {
      indexSyncPromise = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;

    if (message.type === 'POS_WIKI_SUGGEST') {
      const expectedHost = message.game === 'poe2' ? 'www.poe2wiki.net' : 'www.poewiki.net';
      if (location.hostname !== expectedHost) {
        sendResponse({ ok: false, error: 'WRONG_WIKI' });
        return false;
      }

      searchWiki(String(message.query || '').trim(), Number(message.limit) || 20)
        .then(items => {
          sendResponse({ ok: true, items });
          // Refresh the reusable offline title index without delaying autocomplete.
          syncWikiTitleIndex(false).catch(() => {});
        })
        .catch(err => sendResponse({ ok: false, error: err?.message || 'WIKI_API_FAILED' }));

      return true;
    }

    if (message.type === 'POS_WIKI_SYNC_INDEX') {
      syncWikiTitleIndex(Boolean(message.force))
        .then(result => sendResponse({ ok: true, count: result?.count || 0, updatedAt: result?.updatedAt || 0 }))
        .catch(err => sendResponse({ ok: false, error: err?.message || 'WIKI_INDEX_SYNC_FAILED' }));
      return true;
    }

    return false;
  });

  // After the user has passed Anubis and the real Wiki page loads, quietly
  // build/update the local title index. Once complete, the Wiki tab can be
  // closed and autocomplete keeps working from chrome.storage.local.
  setTimeout(() => {
    syncWikiTitleIndex(false).catch(() => {});
  }, 1200);
})();
