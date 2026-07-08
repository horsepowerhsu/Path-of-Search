const CONFIG = {
  WIKI_LIMIT: 20,
  DB_RESULT_LIMIT: 80,
  DB_VISIBLE_ROWS: 8,
  MIN_SUGGESTION_LENGTH: 1,
  DB_DEBOUNCE_MS: 300,
  WIKI_DEBOUNCE_MS: 420,
  DB_PREFETCH_OTHER_GAME_DELAY_MS: 1200,
  DB_FALLBACK_FILES: {
    poe: {
      us: 'https://cdn.poedb.tw/json/autocomplete_us.78a1baa733950208.json',
      tw: 'https://cdn.poedb.tw/json/autocomplete_tw.d18eafeb972db1fa.json'
    },
    poe2: {
      us: 'https://cdn.poe2db.tw/json/autocompletecb_us.1fda452f2a03cc41.json',
      tw: 'https://cdn.poe2db.tw/json/autocompletecb_tw.8b0b768c77a5fbc7.json'
    }
  }
};
