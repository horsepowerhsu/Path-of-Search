const wikiCache = new Map();
let wikiAbortController = null;

function getWikiBaseUrlForGame(game) {
  return game === 'poe2' ? 'https://www.poe2wiki.net' : 'https://www.poewiki.net';
}

function getWikiCacheKey(query, game = state.game) {
  return `pos:wiki:${game}:${query.trim().toLowerCase()}:v4`;
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

function mapWikiOpenSearch(data) {
  return Array.isArray(data?.[1])
    ? data[1].map(label => ({ label, value: label }))
    : [];
}

function mapWikiPrefixSearch(data) {
  return Array.isArray(data?.query?.prefixsearch)
    ? data.query.prefixsearch.map(item => ({ label: item.title, value: item.title }))
    : [];
}

function mapWikiSearch(data) {
  return Array.isArray(data?.query?.search)
    ? data.query.search.map(item => ({ label: item.title, value: item.title }))
    : [];
}

async function fetchWikiOpenSearch(query, game, signal) {
  const baseUrl = getWikiBaseUrlForGame(game);
  const params = new URLSearchParams({
    action: 'opensearch',
    search: query,
    limit: String(CONFIG.WIKI_LIMIT),
    namespace: '0',
    format: 'json',
    origin: '*'
  });

  const res = await posFetchWithRetry(`${baseUrl}/api.php?${params.toString()}`, { signal }, 2, 350);
  return mapWikiOpenSearch(await res.json());
}

async function fetchWikiPrefixSearch(query, game, signal) {
  const baseUrl = getWikiBaseUrlForGame(game);
  const params = new URLSearchParams({
    action: 'query',
    list: 'prefixsearch',
    pssearch: query,
    pslimit: String(CONFIG.WIKI_LIMIT),
    format: 'json',
    origin: '*'
  });

  const res = await posFetchWithRetry(`${baseUrl}/api.php?${params.toString()}`, { signal }, 2, 350);
  return mapWikiPrefixSearch(await res.json());
}

async function fetchWikiFullTextSearch(query, game, signal) {
  const baseUrl = getWikiBaseUrlForGame(game);
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(CONFIG.WIKI_LIMIT),
    srnamespace: '0',
    format: 'json',
    origin: '*'
  });

  const res = await posFetchWithRetry(`${baseUrl}/api.php?${params.toString()}`, { signal }, 2, 350);
  return mapWikiSearch(await res.json());
}

async function fetchWikiVariantFromApi(query, game, signal) {
  const openSearchItems = await fetchWikiOpenSearch(query, game, signal);
  if (openSearchItems.length) return openSearchItems;

  const prefixItems = await fetchWikiPrefixSearch(query, game, signal);
  if (prefixItems.length) return prefixItems;

  return fetchWikiFullTextSearch(query, game, signal);
}

async function fetchWikiFromApi(query, game, signal) {
  const variants = POS_SEARCH.getQueryVariants(query, 6);
  const results = await Promise.allSettled(
    variants.map(variant => fetchWikiVariantFromApi(variant, game, signal))
  );

  const items = uniqueWikiItems(results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value));

  const ranked = POS_SEARCH.rank(items, query, CONFIG.WIKI_LIMIT);

  // Important: Wiki API suggestions are already relevant even when our local fuzzy
  // score cannot match the user's original unordered query. Keep the old behavior
  // instead of showing an empty suggestion list.
  return ranked.length ? ranked : items.slice(0, CONFIG.WIKI_LIMIT);
}

async function fetchWikiSuggestions(query, game = state.game) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const key = getWikiCacheKey(normalizedQuery, game);
  if (wikiCache.has(key)) return wikiCache.get(key);

  const cached = await posStorageGet(key);
  if (cached && Array.isArray(cached.items) && cached.items.length) {
    wikiCache.set(key, cached.items);

    if (!posCacheIsFresh(cached, POS_CACHE_TTL.WIKI_RESULT)) {
      refreshWikiSuggestions(normalizedQuery, game).catch(() => {});
    }

    return cached.items;
  }

  return refreshWikiSuggestions(normalizedQuery, game);
}

async function refreshWikiSuggestions(query, game = state.game) {
  const key = getWikiCacheKey(query, game);

  if (wikiAbortController) wikiAbortController.abort();
  wikiAbortController = new AbortController();

  const items = await fetchWikiFromApi(query, game, wikiAbortController.signal);

  if (items.length) {
    wikiCache.set(key, items);
    await posStorageSet(key, {
      updatedAt: Date.now(),
      items
    });
  }

  return items;
}
