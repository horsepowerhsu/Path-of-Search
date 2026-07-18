const dbDataCache = new Map();
const dbDataUrlCache = new Map();
const dbManifestCache = new Map();
const dbDataLoaders = new Map();
const dbManifestLoaders = new Map();
const dbManifestRefreshLoaders = new Map();
const dbWarmupGames = new Set();

function getDbHostForGame(game) {
  return game === 'poe2' ? 'https://poe2db.tw' : 'https://poedb.tw';
}

function getDbCdnHostForGame(game) {
  return game === 'poe2' ? 'https://cdn.poe2db.tw' : 'https://cdn.poedb.tw';
}

function getDbSiteHomeForGame(game, lang = 'tw') {
  return `${getDbHostForGame(game)}/${lang}/`;
}

function toDbEnglishSlug(text) {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join('_');
}

function buildDbUrl(term, forcedLang = null) {
  const raw = term.trim();
  const host = getDbHost();
  const lang = forcedLang || getDbLang(raw);

  if (lang === 'tw') {
    const q = encodeURIComponent(raw).replace(/%20/g, '+');
    return `${host}/tw/search?q=${q}`;
  }

  const slug = encodeURIComponent(toDbEnglishSlug(raw));
  return `${host}/us/${slug}`;
}

function normalizeDbValue(value, fallbackTerm, forcedLang = null) {
  const host = getDbHost();
  if (!value) return buildDbUrl(fallbackTerm, forcedLang);

  const lang = forcedLang || getDbLang(fallbackTerm || '');
  const langCodes = ['us', 'cn', 'ru', 'pt', 'th', 'fr', 'de', 'sp', 'kr', 'tw', 'jp'];

  let url;
  try {
    url = new URL(value, host);
  } catch (_) {
    return buildDbUrl(fallbackTerm, forcedLang);
  }

  if (url.hostname !== new URL(host).hostname) {
    return url.href;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    url.pathname = `/${lang}/`;
  } else if (langCodes.includes(parts[0])) {
    parts[0] = lang;
    url.pathname = `/${parts.join('/')}`;
  } else {
    url.pathname = `/${lang}/${parts.join('/')}`;
  }

  return url.href;
}

function getAutocompleteId(lang, game = state.game) {
  const prefix = game === 'poe2' ? 'autocompletecb' : 'autocomplete';
  return `${prefix}_${lang}.json`;
}

function getDbManifestCacheKey(game = state.game) {
  return `pos:db:manifest:${game}:v4`;
}

function getDbDataCacheKey(lang, game = state.game) {
  return `pos:db:data:${game}:${lang}:v4`;
}

function extractHeaderScriptUrl(html, pageUrl) {
  const re = /<script[^>]+src=["']([^"']*poedb_header[^"']*\.js)["']/i;
  const match = html.match(re);
  if (!match) return null;
  return new URL(match[1], pageUrl).href;
}

function extractAutocompleteMap(headerJs) {
  const map = {};
  const pairRe = /['"](autocomplete(?:cb)?_[a-z]{2}\.json)['"]\s*:\s*['"]([^'"]+\.json)['"]/g;
  let match;
  while ((match = pairRe.exec(headerJs)) !== null) {
    map[match[1]] = match[2];
  }
  return map;
}

async function downloadDbAutocompleteManifest(game) {
  const pageUrl = getDbSiteHomeForGame(game, 'tw');
  const pageRes = await posFetchWithRetry(pageUrl, { cache: 'no-store' }, 2, 350);

  const html = await pageRes.text();
  const headerUrl = extractHeaderScriptUrl(html, pageUrl);
  if (!headerUrl) throw new Error('PoEDB header script not found');

  const headerRes = await posFetchWithRetry(headerUrl, { cache: 'no-store' }, 2, 350);
  const headerJs = await headerRes.text();
  const map = extractAutocompleteMap(headerJs);
  if (!Object.keys(map).length) throw new Error('PoEDB autocomplete map not found');

  return map;
}

async function fetchDbAutocompleteManifest(game = state.game) {
  if (dbManifestCache.has(game)) return dbManifestCache.get(game);

  const storageKey = getDbManifestCacheKey(game);
  const cached = await posStorageGet(storageKey);
  if (cached && cached.map) {
    dbManifestCache.set(game, cached.map);
    if (!posCacheIsFresh(cached, POS_CACHE_TTL.DB_MANIFEST)) {
      refreshDbAutocompleteManifest(game).catch(() => {});
    }
    return cached.map;
  }

  if (dbManifestLoaders.has(game)) return dbManifestLoaders.get(game);

  const loader = downloadDbAutocompleteManifest(game)
    .then(async map => {
      dbManifestCache.set(game, map);
      await posStorageSet(storageKey, { updatedAt: Date.now(), map });
      return map;
    })
    .finally(() => dbManifestLoaders.delete(game));

  dbManifestLoaders.set(game, loader);
  return loader;
}

async function refreshDbAutocompleteManifest(game = state.game) {
  if (dbManifestRefreshLoaders.has(game)) {
    return dbManifestRefreshLoaders.get(game);
  }

  const storageKey = getDbManifestCacheKey(game);
  const loader = downloadDbAutocompleteManifest(game)
    .then(async map => {
      dbManifestCache.set(game, map);
      await posStorageSet(storageKey, { updatedAt: Date.now(), map });
      return map;
    })
    .finally(() => dbManifestRefreshLoaders.delete(game));

  dbManifestRefreshLoaders.set(game, loader);
  return loader;
}

function getDbAutocompleteUrlFromManifest(manifest, lang, game = state.game) {
  const jsonFile = manifest?.[getAutocompleteId(lang, game)];
  return jsonFile ? `${getDbCdnHostForGame(game)}/json/${jsonFile}` : '';
}

async function getDbAutocompleteUrl(lang, game = state.game) {
  try {
    const manifest = await fetchDbAutocompleteManifest(game);
    const url = getDbAutocompleteUrlFromManifest(manifest, lang, game);
    if (url) return url;
  } catch (_) {
    // Static fallback keeps suggestions usable when the PoEDB header script is unavailable.
  }

  return CONFIG.DB_FALLBACK_FILES[game]?.[lang] || '';
}

async function downloadDbAutocompleteData(lang, game = state.game, forcedUrl = '') {
  const url = forcedUrl || await getDbAutocompleteUrl(lang, game);
  if (!url) throw new Error('PoEDB autocomplete URL unavailable');

  const res = await posFetchWithRetry(url, { cache: 'no-store' }, 2, 350);
  const data = await res.json();
  const items = Array.isArray(data) ? data : [];

  if (!items.length) {
    throw new Error('PoEDB autocomplete data empty');
  }

  return { url, items };
}

async function refreshDbAutocompleteData(lang, game = state.game, forcedUrl = '') {
  const loaderKey = `${game}:${lang}`;
  if (dbDataLoaders.has(loaderKey)) return dbDataLoaders.get(loaderKey);

  const storageKey = getDbDataCacheKey(lang, game);
  const loader = downloadDbAutocompleteData(lang, game, forcedUrl)
    .then(async ({ url, items }) => {
      dbDataCache.set(loaderKey, items);
      dbDataUrlCache.set(loaderKey, url);
      await posStorageSet(storageKey, {
        updatedAt: Date.now(),
        url,
        items
      });
      return items;
    })
    .finally(() => dbDataLoaders.delete(loaderKey));

  dbDataLoaders.set(loaderKey, loader);
  return loader;
}

async function getDbAutocompleteData(lang, game = state.game) {
  const key = `${game}:${lang}`;
  const storageKey = getDbDataCacheKey(lang, game);
  let cached = null;

  if (dbDataCache.has(key)) {
    cached = {
      url: dbDataUrlCache.get(key) || '',
      items: dbDataCache.get(key)
    };
  } else {
    cached = await posStorageGet(storageKey);
    if (cached && Array.isArray(cached.items) && cached.items.length) {
      dbDataCache.set(key, cached.items);
      dbDataUrlCache.set(key, cached.url || '');
    }
  }

  try {
    // Always check the live header first. The hashed JSON filename changes when
    // PoEDB / PoE2DB updates its autocomplete data.
    const manifest = await refreshDbAutocompleteManifest(game);
    const latestUrl = getDbAutocompleteUrlFromManifest(manifest, lang, game);

    if (latestUrl) {
      if (cached && cached.url === latestUrl && Array.isArray(cached.items) && cached.items.length) {
        return cached.items;
      }
      return refreshDbAutocompleteData(lang, game, latestUrl);
    }
  } catch (_) {
    // If the update check is temporarily unavailable, keep the last good cache.
  }

  if (cached && Array.isArray(cached.items) && cached.items.length) {
    return cached.items;
  }

  return refreshDbAutocompleteData(lang, game);
}

async function warmDbAutocomplete(game = state.game) {
  if (dbWarmupGames.has(game)) return;
  dbWarmupGames.add(game);

  await Promise.allSettled([
    getDbAutocompleteData('tw', game),
    getDbAutocompleteData('us', game)
  ]);
}

function warmAllDbAutocomplete() {
  const currentGame = state.game;
  const otherGame = currentGame === 'poe2' ? 'poe' : 'poe2';

  warmDbAutocomplete(currentGame).catch(() => {});
  setTimeout(() => {
    warmDbAutocomplete(otherGame).catch(() => {});
  }, CONFIG.DB_PREFETCH_OTHER_GAME_DELAY_MS);
}

function mapDbSuggestionItem(item) {
  return {
    label: item.label || item.value || '',
    desc: item.desc || '',
    value: item.value || '',
    className: item.class || ''
  };
}

async function fetchDbSuggestions(query, game = state.game) {
  const lang = getDbLang(query);
  const data = await getDbAutocompleteData(lang, game);
  const items = data.map(mapDbSuggestionItem);

  return POS_SEARCH.rank(items, query, CONFIG.DB_RESULT_LIMIT);
}
