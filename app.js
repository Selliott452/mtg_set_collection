(() => {
  'use strict';

  const SCRIPT_URL = ((window.MTG_CONFIG && window.MTG_CONFIG.scriptUrl) || '').trim();
  const MAIN_TYPES = ['core', 'expansion'];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pretty = t => String(t).replace(/_/g, ' ');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const status = msg => { $('status').textContent = msg || ''; };
  // A card is identified by its set code + collector number, e.g. "dsk|123".
  const keyOf = (set, number) => set + '|' + number;

  const state = {
    sets: [],
    setByCode: new Map(),
    owned: new Map(),   // "set|number" -> { set, number, name }
    cards: new Map(),   // set code -> card list from Scryfall (cached for this visit)
    pending: new Map(), // unsaved changes, keyed like `owned`
    route: null,
    ui: { q: '', type: 'main', hideDone: false, startedOnly: false, show: 'all', cq: '' },
  };
  let token = ls.get('mtg-token') || '';

  /* ---------- Storage: Google Sheet via Apps Script, or this browser if not configured ---------- */

  const remote = {
    async load() {
      const res = await fetch(SCRIPT_URL);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Load failed');
      return data.cards;
    },
    async save(changes) {
      // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, changes }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Save failed');
    },
  };
  const local = {
    async load() {
      try { return JSON.parse(ls.get('mtg-collection') || '[]'); } catch { return []; }
    },
    async save() { ls.set('mtg-collection', JSON.stringify([...state.owned.values()])); },
  };
  const store = SCRIPT_URL ? remote : local;
  const canWrite = () => !SCRIPT_URL || !!token;

  /* ---------- Scryfall ---------- */

  async function loadSets() {
    const res = await fetch('https://api.scryfall.com/sets', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Scryfall sets: ' + res.status);
    const { data } = await res.json();
    state.sets = data
      .filter(s => !s.digital && s.card_count > 0)
      .map(s => ({
        code: s.code, name: s.name, released: s.released_at || '', type: s.set_type,
        parent: s.parent_set_code || '', total: s.card_count, icon: s.icon_svg_uri || '',
      }))
      .sort((a, b) => b.released.localeCompare(a.released));
    state.setByCode = new Map(state.sets.map(s => [s.code, s]));
  }

  async function fetchSetCards(code) {
    if (state.cards.has(code)) return state.cards.get(code);
    const params = new URLSearchParams({
      q: `e:${code} game:paper`, unique: 'prints', order: 'set', dir: 'asc',
      include_extras: 'true', include_variations: 'true',
    });
    let url = 'https://api.scryfall.com/cards/search?' + params;
    const cards = [];
    const seen = new Set();
    while (url) {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status === 404) break; // no matching cards
      if (!res.ok) throw new Error('Scryfall cards: ' + res.status);
      const page = await res.json();
      for (const c of page.data) {
        if (seen.has(c.collector_number)) continue; // one entry per collector number
        seen.add(c.collector_number);
        cards.push({
          number: c.collector_number,
          name: c.name,
          img: (c.image_uris && c.image_uris.small) ||
               (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.small) || '',
        });
      }
      url = page.has_more ? page.next_page : null;
      if (url) await sleep(100); // stay well inside Scryfall's rate limit
    }
    state.cards.set(code, cards);
    return cards;
  }

  /* ---------- Saving ---------- */

  let flushTimer = null, saving = false;

  function scheduleFlush(delay = 800) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delay);
  }

  async function flush() {
    if (saving) return scheduleFlush();
    if (!state.pending.size) return;
    const changes = [...state.pending.values()];
    state.pending.clear();
    saving = true;
    status('Saving…');
    try {
      await store.save(changes);
      status(state.pending.size ? 'Unsaved changes…' : 'Saved');
    } catch (e) {
      for (const c of changes) {
        const k = keyOf(c.set, c.number);
        if (!state.pending.has(k)) state.pending.set(k, c);
      }
      status(`Save failed (${e.message}). Retrying…`);
      scheduleFlush(5000);
    } finally {
      saving = false;
    }
  }

  window.addEventListener('beforeunload', e => {
    if (state.pending.size || saving) { e.preventDefault(); e.returnValue = ''; }
  });

  function toggle(setCode, card) {
    if (!canWrite()) { status('Read-only. Click "Write key" to edit.'); return; }
    const k = keyOf(setCode, card.number);
    const row = { set: setCode, number: card.number, name: card.name };
    const nowOwned = !state.owned.has(k);
    if (nowOwned) state.owned.set(k, row); else state.owned.delete(k);
    state.pending.set(k, { ...row, owned: nowOwned });
    status('Unsaved changes…');
    scheduleFlush();
  }

  /* ---------- Overview ---------- */

  const totalFor = s => (state.cards.has(s.code) ? state.cards.get(s.code).length : s.total);

  function ownedCountBySet() {
    const m = new Map();
    for (const r of state.owned.values()) {
      if (!m.has(r.set)) m.set(r.set, new Set());
      m.get(r.set).add(r.number);
    }
    return m;
  }

  function renderOverview() {
    document.title = 'MTG Master Sets';
    const { ui } = state;
    const types = [...new Set(state.sets.map(s => s.type))].sort();
    $('view').innerHTML = `
      <div class="controls">
        <input type="search" id="q" placeholder="Search name or code" value="${esc(ui.q)}">
        <select id="type">
          <option value="main">Core + expansion</option>
          <option value="all">All printed sets</option>
          ${types.map(t => `<option value="${esc(t)}">${esc(pretty(t))}</option>`).join('')}
        </select>
        <label><input type="checkbox" id="hideDone" ${ui.hideDone ? 'checked' : ''}> Hide complete</label>
        <label><input type="checkbox" id="startedOnly" ${ui.startedOnly ? 'checked' : ''}> Started only</label>
      </div>
      <div class="summary" id="summary"></div>
      <div id="list"></div>`;
    $('type').value = ui.type;
    $('q').addEventListener('input', e => { ui.q = e.target.value; drawList(); });
    $('type').addEventListener('input', e => { ui.type = e.target.value; drawList(); });
    $('hideDone').addEventListener('input', e => { ui.hideDone = e.target.checked; drawList(); });
    $('startedOnly').addEventListener('input', e => { ui.startedOnly = e.target.checked; drawList(); });
    drawList();
  }

  function drawList() {
    const { ui } = state;
    const by = ownedCountBySet();
    const have = s => (by.get(s.code) || { size: 0 }).size;
    const isDone = s => have(s) >= totalFor(s);
    const scope = state.sets.filter(s =>
      ui.type === 'all' || (ui.type === 'main' ? MAIN_TYPES.includes(s.type) : s.type === ui.type));

    const owned = scope.reduce((n, s) => n + Math.min(have(s), totalFor(s)), 0);
    const total = scope.reduce((n, s) => n + totalFor(s), 0);
    $('summary').textContent =
      `${scope.filter(isDone).length} of ${scope.length} sets complete · ` +
      `${owned.toLocaleString()} / ${total.toLocaleString()} cards ` +
      `(${total ? (owned / total * 100).toFixed(1) : '0.0'}%)`;

    const q = ui.q.trim().toLowerCase();
    const list = scope.filter(s =>
      (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) &&
      !(ui.hideDone && isDone(s)) &&
      !(ui.startedOnly && have(s) === 0));

    $('list').innerHTML = list.length ? list.map(s => {
      const h = have(s), t = totalFor(s), pct = t ? Math.min(100, Math.round(h / t * 100)) : 0;
      return `<a class="set${isDone(s) ? ' done' : ''}" href="#/set/${encodeURIComponent(s.code)}">
        ${s.icon ? `<img class="icon" src="${esc(s.icon)}" alt="" loading="lazy">` : '<span></span>'}
        <div>
          <div class="name">${esc(s.name)}</div>
          <div class="meta">${esc(s.code.toUpperCase())} · ${esc(s.released)} · ${esc(pretty(s.type))}${
            s.parent ? ' · part of ' + esc(s.parent.toUpperCase()) : ''}</div>
          <div class="bar"><span style="width:${pct}%"></span></div>
        </div>
        <div class="count">${h} / ${t}</div>
      </a>`;
    }).join('') : '<p class="empty">Nothing matches these filters.</p>';
  }

  /* ---------- Set view ---------- */

  async function renderSet(code) {
    const s = state.setByCode.get(code);
    if (!s) { $('view').innerHTML = '<a class="back" href="#/">← All sets</a><p class="empty">Unknown set.</p>'; return; }
    document.title = `${s.name} · Master Sets`;
    const { ui } = state;
    $('view').innerHTML = `
      <a class="back" href="#/">← All sets</a>
      <div class="sethead">
        ${s.icon ? `<img class="icon" src="${esc(s.icon)}" alt="">` : ''}
        <div>
          <h2>${esc(s.name)}</h2>
          <div class="meta">${esc(s.code.toUpperCase())} · ${esc(s.released)} · ${esc(pretty(s.type))}</div>
        </div>
      </div>
      <div class="summary" id="summary"></div>
      <div class="controls">
        <select id="show">
          <option value="all">All cards</option>
          <option value="missing">Missing</option>
          <option value="owned">Owned</option>
        </select>
        <input type="search" id="cq" placeholder="Filter by name or number" value="${esc(ui.cq)}">
      </div>
      <div class="grid" id="grid"><p class="empty">Loading cards from Scryfall…</p></div>`;
    $('show').value = ui.show;

    let cards;
    try {
      cards = await fetchSetCards(code);
    } catch (e) {
      if (state.route === code) $('grid').innerHTML = `<p class="empty">Couldn't load cards: ${esc(e.message)}</p>`;
      return;
    }
    if (state.route !== code) return; // navigated away while loading

    const byNumber = new Map(cards.map(c => [c.number, c]));
    $('show').addEventListener('input', e => { ui.show = e.target.value; drawGrid(s, cards); });
    $('cq').addEventListener('input', e => { ui.cq = e.target.value; drawGrid(s, cards); });
    $('grid').addEventListener('click', e => {
      const tile = e.target.closest('.card');
      if (!tile) return;
      const card = byNumber.get(tile.dataset.number);
      toggle(s.code, card);
      tile.outerHTML = tileHtml(s.code, card);
      drawSetSummary(s.code, cards);
    });
    $('grid').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card')) {
        e.preventDefault();
        const number = e.target.dataset.number;
        e.target.click();
        document.querySelector(`.card[data-number="${CSS.escape(number)}"]`)?.focus();
      }
    });
    drawGrid(s, cards);
  }

  const isOwned = (setCode, c) => state.owned.has(keyOf(setCode, c.number));

  function drawSetSummary(setCode, cards) {
    const have = cards.filter(c => isOwned(setCode, c)).length;
    $('summary').textContent = cards.length
      ? `${have} / ${cards.length} collector numbers (${(have / cards.length * 100).toFixed(1)}%)` +
        (have === cards.length ? ' · Complete!' : ` · ${cards.length - have} to go`)
      : 'Scryfall has no paper cards for this set.';
  }

  function drawGrid(s, cards) {
    drawSetSummary(s.code, cards);
    const { show, cq } = state.ui;
    const q = cq.trim().toLowerCase();
    const list = cards.filter(c => {
      const o = isOwned(s.code, c);
      if (show === 'missing' && o) return false;
      if (show === 'owned' && !o) return false;
      return !q || c.name.toLowerCase().includes(q) || c.number.toLowerCase() === q;
    });
    $('grid').innerHTML = list.length
      ? list.map(c => tileHtml(s.code, c)).join('')
      : '<p class="empty">No cards match.</p>';
  }

  function tileHtml(setCode, c) {
    const own = isOwned(setCode, c);
    return `<div class="card${own ? ' own' : ''}" data-number="${esc(c.number)}" role="button" tabindex="0"
        aria-pressed="${own}" title="${own ? 'Owned. Click to unmark' : 'Click to mark as owned'}">
      <div class="img">${c.img
        ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy">`
        : `<div class="noimg">${esc(c.name)}</div>`}</div>
      <div class="cinfo"><span class="num">#${esc(c.number)}</span><span class="cname">${esc(c.name)}</span></div>
    </div>`;
  }

  /* ---------- Routing, write key, startup ---------- */

  function route() {
    const m = location.hash.match(/^#\/set\/([^/]+)/);
    state.route = m ? decodeURIComponent(m[1]) : null;
    window.scrollTo(0, 0);
    if (state.route) renderSet(state.route); else renderOverview();
  }

  function updateMode() {
    $('keyBtn').hidden = !SCRIPT_URL;
    $('mode').textContent = !SCRIPT_URL ? 'Saved in this browser only' : token ? 'Editing' : 'Read-only';
  }

  $('keyBtn').addEventListener('click', () => { $('keyInput').value = token; $('keyDialog').showModal(); });
  $('keyDialog').addEventListener('close', () => {
    if ($('keyDialog').returnValue !== 'save') return;
    token = $('keyInput').value.trim();
    ls.set('mtg-token', token);
    updateMode();
  });

  async function start() {
    updateMode();
    status('Loading…');
    const [setsRes, collRes] = await Promise.allSettled([loadSets(), store.load()]);
    if (setsRes.status === 'rejected') {
      $('view').innerHTML = `<p class="empty">Couldn't reach Scryfall: ${esc(setsRes.reason.message)}</p>`;
      status('');
      return;
    }
    if (collRes.status === 'fulfilled') {
      for (const r of collRes.value) state.owned.set(keyOf(r.set, String(r.number)), r);
      status('');
    } else {
      status(`Couldn't load your collection: ${collRes.reason.message}`);
    }
    window.addEventListener('hashchange', route);
    route();
  }

  start();
})();
