const form = document.getElementById('searchForm');
const input = document.getElementById('q');
const suggestionBox = document.getElementById('suggestion-box');
const wikiToggle = document.getElementById('wiki-toggle');
const logo = document.getElementById('wiki-logo');
const wikiTitle = document.getElementById('wiki-title');
const poeLabel = document.getElementById('poe-label');
const poe2Label = document.getElementById('poe2-label');
const sourceWiki = document.getElementById('source-wiki');
const sourceDb = document.getElementById('source-db');

let suggestions = [];
let activeIndex = -1;

function applyState() {
  const isPoe2 = state.game === 'poe2';
  const isDb = state.source === 'db';

  wikiToggle.checked = isPoe2;
  poeLabel.classList.toggle('active', !isPoe2);
  poe2Label.classList.toggle('active', isPoe2);
  sourceWiki.classList.toggle('active', !isDb);
  sourceDb.classList.toggle('active', isDb);
  sourceDb.textContent = getDbName();

  const nextLogo = isPoe2 ? 'icons/poe2_logo.png' : 'icons/poe_logo.png';
  if (!logo.getAttribute('src')?.endsWith(nextLogo)) {
    logo.src = nextLogo;
  }

  const title = getTitle();
  wikiTitle.textContent = title;
  input.placeholder = `Search ${title}...`;
  saveState();
  clearSuggestions();
  requestSuggestions(input.value.trim());
}

function clearSuggestions() {
  suggestions = [];
  activeIndex = -1;
  suggestionBox.innerHTML = '';
  suggestionBox.classList.remove('show');
}

function showSuggestionStatus(message) {
  suggestions = [];
  activeIndex = -1;
  suggestionBox.innerHTML = `<div class="suggestion-empty">${message}</div>`;
  suggestionBox.classList.add('show');
}

function showSuggestionLoading() {
  suggestions = [];
  activeIndex = -1;
  suggestionBox.innerHTML = `
    <div class="suggestion-loading" aria-label="Loading suggestions">
      <span class="loading-spinner"></span>
    </div>
  `;
  suggestionBox.classList.add('show');
}

function appendHighlightedText(parent, text, query) {
  const source = String(text || '');
  const needle = String(query || '').trim();
  if (!needle) {
    parent.textContent = source;
    return;
  }

  const sourceLower = source.toLowerCase();
  const needleLower = needle.toLowerCase();
  let start = 0;
  let index = sourceLower.indexOf(needleLower, start);

  if (index === -1) {
    parent.textContent = source;
    return;
  }

  while (index !== -1) {
    if (index > start) {
      parent.appendChild(document.createTextNode(source.slice(start, index)));
    }
    const mark = document.createElement('mark');
    mark.textContent = source.slice(index, index + needle.length);
    parent.appendChild(mark);
    start = index + needle.length;
    index = sourceLower.indexOf(needleLower, start);
  }

  if (start < source.length) {
    parent.appendChild(document.createTextNode(source.slice(start)));
  }
}

function renderSuggestions(items) {
  suggestions = items;
  activeIndex = -1;
  suggestionBox.innerHTML = '';

  const query = input.value.trim();
  if (!query || query.length < CONFIG.MIN_SUGGESTION_LENGTH) {
    suggestionBox.classList.remove('show');
    return;
  }

  if (!suggestions.length) {
    showSuggestionStatus('No suggestions');
    return;
  }

  for (const item of suggestions) {
    const row = document.createElement('div');
    row.className = 'suggestion-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion-item';

    const label = document.createElement('span');
    label.className = 'suggestion-label';
    appendHighlightedText(label, item.label || item, query);
    btn.appendChild(label);

    if (item.desc) {
      const desc = document.createElement('small');
      desc.className = 'suggestion-desc';
      desc.textContent = item.desc;
      btn.appendChild(desc);
    }

    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      search(item);
    });
    row.appendChild(btn);

    if (state.source === 'db') {
      const languageActions = document.createElement('div');
      languageActions.className = 'suggestion-language-actions';

      const twButton = document.createElement('button');
      twButton.type = 'button';
      twButton.className = 'suggestion-language-btn';
      twButton.textContent = '中';
      twButton.title = '以繁體中文開啟';
      twButton.setAttribute('aria-label', 'Open in Traditional Chinese');
      twButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        search(item, 'tw');
      });

      const usButton = document.createElement('button');
      usButton.type = 'button';
      usButton.className = 'suggestion-language-btn';
      usButton.textContent = 'EN';
      usButton.title = 'Open in English';
      usButton.setAttribute('aria-label', 'Open in English');
      usButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        search(item, 'us');
      });

      languageActions.append(twButton, usButton);
      row.appendChild(languageActions);
    }

    suggestionBox.appendChild(row);
  }
  suggestionBox.classList.add('show');
}

function setActive(index) {
  const nodes = [...suggestionBox.querySelectorAll('.suggestion-item')];
  if (!nodes.length) return;
  activeIndex = (index + nodes.length) % nodes.length;
  nodes.forEach((node, i) => node.classList.toggle('active', i === activeIndex));
  nodes[activeIndex].scrollIntoView({ block: 'nearest' });
}
