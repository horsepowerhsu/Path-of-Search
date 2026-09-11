const wikiCache = new Map();
let wikiAbortController = null;

const WIKI_INDEX_VERSION = 1;

function getWikiBaseUrlForGame(game) {
  return game === 'poe2' ? 'https://www.poe2wiki.net' : 'https://www.poewiki.net';
}

function getWikiCacheKey(query, game = state.game) {
  return `pos:wiki:${game}:${query.trim().toLowerCase()}:v8`;
}

function getWikiIndexKey(game = state.game) {
  return `pos:wiki-index:${game}:v${WIKI_INDEX_VERSION}`;
}

function uniqueWikiItems(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = POS_SEARCH.normalize(item?.label || item?.value || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chromeCall(fn) {
  return new Promise((resolve, reject) => {
    fn(result => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

async function findWikiTab(game) {
  const baseUrl = getWikiBaseUrlForGame(game);
  const tabs = await chromeCall(cb => chrome.tabs.query({ url: `${baseUrl}/*` }, cb));
  if (!Array.isArray(tabs) || !tabs.length) return null;

  const active = tabs.find(tab => tab.active);
  return active || tabs[0];
}

async function injectWikiBridge(tabId) {
  if (!chrome.scripting?.executeScript) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['js/wiki-bridge.js']
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function sendWikiBridgeMessage(tabId, payload) {
  try {
    return await chromeCall(cb => chrome.tabs.sendMessage(tabId, payload, cb));
  } catch (_) {
    const injected = await injectWikiBridge(tabId);
    if (!injected) return null;
    try {
      return await chromeCall(cb => chrome.tabs.sendMessage(tabId, payload, cb));
    } catch (_) {
      return null;
    }
  }
}

async function fetchWikiVariantThroughTab(query, game) {
  const tab = await findWikiTab(game);
  if (!tab?.id) {
    const err = new Error('WIKI_TAB_REQUIRED');
    err.code = 'WIKI_TAB_REQUIRED';
    throw err;
  }

  const response = await sendWikiBridgeMessage(tab.id, {
    type: 'POS_WIKI_SUGGEST',
    game,
    query,
    limit: CONFIG.WIKI_LIMIT
  });

  if (!response?.ok) {
    const err = new Error(response?.error || 'WIKI_BRIDGE_FAILED');
    err.code = response?.error || 'WIKI_BRIDGE_FAILED';
    throw err;
  }

  return Array.isArray(response.items) ? response.items : [];
}

async function fetchWikiThroughTab(query, game, signal) {
  const variants = POS_SEARCH.getQueryVariants(query, 6);
  const results = [];

  for (const variant of variants) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const items = await fetchWikiVariantThroughTab(variant, game);
      results.push(...items);
      if (results.length >= CONFIG.WIKI_LIMIT * 2) break;
    } catch (err) {
      if (err?.code === 'WIKI_TAB_REQUIRED') throw err;
    }
  }

  const items = uniqueWikiItems(results);
  const ranked = POS_SEARCH.rank(items, query, CONFIG.WIKI_LIMIT);
  return ranked.length ? ranked : items.slice(0, CONFIG.WIKI_LIMIT);
}

async function searchWikiLocalIndex(query, game) {
  const cached = await posStorageGet(getWikiIndexKey(game));
  const titles = Array.isArray(cached?.titles) ? cached.titles : [];
  if (!titles.length) return { hasIndex: false, items: [] };

  const normalizedQuery = POS_SEARCH.normalize(query);
  const direct = [];
  const other = [];

  for (const title of titles) {
    const normalizedTitle = POS_SEARCH.normalize(title);
    if (!normalizedTitle) continue;
    const item = { label: title, value: title };

    if (normalizedTitle.startsWith(normalizedQuery)) direct.push(item);
    else if (normalizedTitle.includes(normalizedQuery)) other.push(item);
  }

  // Prefix/substring results feel closest to Wiki autocomplete. If there are
  // not enough direct matches, let the existing fuzzy ranker fill the rest.
  let items = uniqueWikiItems([...direct, ...other]);
  if (items.length < CONFIG.WIKI_LIMIT) {
    const allItems = titles.map(title => ({ label: title, value: title }));
    const fuzzy = POS_SEARCH.rank(allItems, query, CONFIG.WIKI_LIMIT * 2);
    items = uniqueWikiItems([...items, ...fuzzy]);
  }

  const ranked = POS_SEARCH.rank(items, query, CONFIG.WIKI_LIMIT);
  return {
    hasIndex: true,
    items: ranked.length ? ranked : items.slice(0, CONFIG.WIKI_LIMIT)
  };
}

function wikiTabRequiredSuggestion(query, game) {
  return [{
    label: game === 'poe2' ? '⚠ 第一次請先開啟 PoE2 Wiki' : '⚠ 第一次請先開啟 PoE Wiki',
    value: query,
    url: `${getWikiBaseUrlForGame(game)}/`
  }];
}

async function fetchWikiSuggestions(query, game = state.game) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const key = getWikiCacheKey(normalizedQuery, game);
  if (wikiCache.has(key)) return wikiCache.get(key);

  const cached = await posStorageGet(key);
  if (cached && Array.isArray(cached.items) && cached.items.length) {
    wikiCache.set(key, cached.items);
    return cached.items;
  }

  // New behavior: search the locally synced Wiki title index first. This works
  // even after the authenticated Wiki tab has been closed.
  const local = await searchWikiLocalIndex(normalizedQuery, game);
  if (local.items.length) {
    wikiCache.set(key, local.items);
    await posStorageSet(key, { updatedAt: Date.now(), items: local.items });
    return local.items;
  }

  // If an index already exists, an empty local result is a legitimate "no
  // matching title" result. Do not force the user to reopen the Wiki tab.
  if (local.hasIndex) return [];

  // No local index yet: use the authenticated Wiki tab once. The content
  // script will also build the full local title index in the background.
  return refreshWikiSuggestions(normalizedQuery, game);
}

async function refreshWikiSuggestions(query, game = state.game) {
  const key = getWikiCacheKey(query, game);
  if (wikiAbortController) wikiAbortController.abort();
  wikiAbortController = new AbortController();

  try {
    const items = await fetchWikiThroughTab(query, game, wikiAbortController.signal);
    if (items.length) {
      wikiCache.set(key, items);
      await posStorageSet(key, { updatedAt: Date.now(), items });
    }
    return items;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err?.code === 'WIKI_TAB_REQUIRED') return wikiTabRequiredSuggestion(query, game);
    throw err;
  }
}
