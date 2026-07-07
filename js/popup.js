let debounceTimer = null;
let suggestionRequestId = 0;

function buildUrl(term) {
  const q = encodeURIComponent(term).replace(/%20/g, '+');
  if (state.source === 'db') return buildDbUrl(term);
  return `${getWikiBaseUrl()}/index.php?search=${q}&title=Special%3ASearch&go=Go`;
}

function search(target) {
  if (!target) return;

  if (typeof target === 'object') {
    if (state.source === 'db') {
      chrome.tabs.create({ url: normalizeDbValue(target.value, target.label) });
      window.close();
      return;
    }
    chrome.tabs.create({ url: buildUrl(target.label || target.value || '') });
    window.close();
    return;
  }

  const raw = String(target).trim();
  if (!raw) return;
  chrome.tabs.create({ url: buildUrl(raw) });
  window.close();
}

function isSameSuggestionRequest(requestId, query, source, game) {
  return requestId === suggestionRequestId &&
    input.value.trim() === query &&
    state.source === source &&
    state.game === game;
}

function requestSuggestions(query) {
  clearTimeout(debounceTimer);

  const requestId = ++suggestionRequestId;

  if (!query || query.length < CONFIG.MIN_SUGGESTION_LENGTH) {
    clearSuggestions();
    return;
  }

  const requestSource = state.source;
  const requestGame = state.game;
  const requestQuery = query;
  const delay = requestSource === 'db' ? CONFIG.DB_DEBOUNCE_MS : CONFIG.WIKI_DEBOUNCE_MS;

  debounceTimer = setTimeout(async () => {
    try {
      if (isSameSuggestionRequest(requestId, requestQuery, requestSource, requestGame)) {
        showSuggestionLoading();
      }

      const items = requestSource === 'db'
        ? await fetchDbSuggestions(requestQuery, requestGame)
        : await fetchWikiSuggestions(requestQuery, requestGame);

      if (isSameSuggestionRequest(requestId, requestQuery, requestSource, requestGame)) {
        renderSuggestions(items);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;

      if (isSameSuggestionRequest(requestId, requestQuery, requestSource, requestGame)) {
        // Network/API failures should never erase a useful visible result.
        if (!suggestions.length) {
          suggestionBox.classList.remove('show');
        }
      }
    }
  }, delay);
}

function warmCurrentSource() {
  if (state.source === 'db') {
    warmDbAutocomplete(state.game).catch(() => {});
  }
}

wikiToggle.addEventListener('change', () => {
  state.game = wikiToggle.checked ? 'poe2' : 'poe';
  applyState();
  warmCurrentSource();
});

sourceWiki.addEventListener('click', () => {
  state.source = 'wiki';
  applyState();
});

sourceDb.addEventListener('click', () => {
  state.source = 'db';
  applyState();
  warmCurrentSource();
});

form.addEventListener('submit', e => {
  e.preventDefault();
  const hasSelectedSuggestion = suggestions.length && suggestionBox.classList.contains('show') && activeIndex >= 0;
  const term = hasSelectedSuggestion ? suggestions[activeIndex] : input.value;
  search(term);
});

input.addEventListener('input', () => requestSuggestions(input.value.trim()));
input.addEventListener('keydown', e => {
  const hasSuggestions = suggestions.length && suggestionBox.classList.contains('show');
  if (e.key === 'Escape') window.close();
  if (!hasSuggestions) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
  if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); search(suggestions[activeIndex]); }
});

input.addEventListener('blur', () => {
  setTimeout(() => suggestionBox.classList.remove('show'), 120);
});
input.addEventListener('focus', () => {
  if (suggestions.length) suggestionBox.classList.add('show');
});

applyState();
warmAllDbAutocomplete();
