const state = {
  game: localStorage.getItem('game') || 'poe',
  source: localStorage.getItem('source') || 'wiki'
};

function saveState() {
  localStorage.setItem('game', state.game);
  localStorage.setItem('source', state.source);
}

function getWikiBaseUrl() {
  return state.game === 'poe2' ? 'https://www.poe2wiki.net' : 'https://www.poewiki.net';
}

function getDbHost() {
  return state.game === 'poe2' ? 'https://poe2db.tw' : 'https://poedb.tw';
}

function getDbCdnHost() {
  return state.game === 'poe2' ? 'https://cdn.poe2db.tw' : 'https://cdn.poedb.tw';
}

function getDbSiteHome(lang = 'tw') {
  return `${getDbHost()}/${lang}/`;
}

function hasChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function getDbLang(text) {
  return hasChinese(text) ? 'tw' : 'us';
}

function getDbName() {
  return state.game === 'poe2' ? 'PoE2DB' : 'PoEDB';
}

function getTitle() {
  if (state.source === 'db') return getDbName();
  return state.game === 'poe2' ? 'PoE2 Wiki' : 'PoE Wiki';
}
