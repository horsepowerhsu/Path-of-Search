(() => {
  if (globalThis.__POS_WIKI_BRIDGE_INSTALLED__) return;
  globalThis.__POS_WIKI_BRIDGE_INSTALLED__ = true;

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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'POS_WIKI_SUGGEST') return false;

    const expectedHost = message.game === 'poe2' ? 'www.poe2wiki.net' : 'www.poewiki.net';
    if (location.hostname !== expectedHost) {
      sendResponse({ ok: false, error: 'WRONG_WIKI' });
      return false;
    }

    searchWiki(String(message.query || '').trim(), Number(message.limit) || 20)
      .then(items => sendResponse({ ok: true, items }))
      .catch(err => sendResponse({ ok: false, error: err?.message || 'WIKI_API_FAILED' }));

    return true;
  });
})();
