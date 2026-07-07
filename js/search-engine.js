const POS_SEARCH = (() => {
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[’'`]/g, '')
      .replace(/[\u3000_\-:()[\]{}<>.,，。;；/\\|!?！？+*#@~"“”]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasCjk(text) {
    return /[\u3400-\u9fff]/.test(String(text || ''));
  }

  function tokenize(query) {
    const q = normalize(query);
    if (!q) return [];

    const parts = q.split(' ').filter(Boolean);

    // When Chinese has no spaces, each Han character becomes a token.
    // Example: 獵路 => [獵, 路], so it can match 獵人之路.
    if (parts.length === 1 && hasCjk(parts[0])) {
      return Array.from(parts[0]).filter(ch => normalize(ch));
    }

    return parts;
  }

  function compact(text) {
    return normalize(text).replace(/\s+/g, '');
  }

  function orderedCharMatch(text, query) {
    const source = compact(text);
    const q = compact(query);
    if (!source || !q) return false;

    let pos = 0;
    for (const ch of q) {
      pos = source.indexOf(ch, pos);
      if (pos === -1) return false;
      pos++;
    }
    return true;
  }

  function unorderedTokenMatch(text, query) {
    const source = normalize(text);
    const sourceCompact = compact(text);
    const tokens = tokenize(query);

    if (!tokens.length || !source) return false;

    return tokens.every(token => {
      const t = normalize(token);
      return t && (source.includes(t) || sourceCompact.includes(compact(t)));
    });
  }

  function scoreText(text, query, weight = 1) {
    const source = normalize(text);
    const q = normalize(query);
    if (!source || !q) return 0;

    if (source === q) return 1000 * weight;
    if (source.startsWith(q)) return 900 * weight;
    if (source.includes(q)) return 780 * weight;
    if (compact(source).includes(compact(q))) return 720 * weight;
    if (unorderedTokenMatch(source, q)) return 560 * weight;
    if (orderedCharMatch(source, q)) return 260 * weight;

    return 0;
  }

  function scoreItem(item, query) {
    const label = item?.label || item?.title || '';
    const value = item?.value || '';
    const desc = item?.desc || '';
    const className = item?.className || item?.class || '';

    return Math.max(
      scoreText(label, query, 1),
      scoreText(value, query, 0.72),
      scoreText(desc, query, 0.45),
      scoreText(className, query, 0.28)
    );
  }

  function rank(items, query, limit = Infinity) {
    const seen = new Set();

    return (items || [])
      .map((item, index) => ({ item, index, score: scoreItem(item, query) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .filter(entry => {
        const key = normalize(entry.item?.label || entry.item?.value || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map(entry => entry.item);
  }

  function getQueryVariants(query, limit = 4) {
    const q = normalize(query);
    const tokens = tokenize(q);
    const variants = [];

    function add(value) {
      const v = normalize(value);
      if (v && !variants.includes(v)) variants.push(v);
    }

    add(q);
    if (tokens.length > 1) {
      add(tokens.join(' '));
      add(tokens.slice().reverse().join(' '));
      for (const token of tokens) add(token);
    }

    return variants.slice(0, limit);
  }

  return {
    normalize,
    tokenize,
    unorderedTokenMatch,
    orderedCharMatch,
    scoreText,
    scoreItem,
    rank,
    getQueryVariants
  };
})();
