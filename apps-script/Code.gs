/**
 * MTG Master Set Tracker — JSON API for the GitHub Pages site.
 *
 * Storage: a "Collection" tab with one row per card you own, identified by
 * set code + collector number (e.g. dsk / 123).
 *
 * GET  <url>  -> { ok, cards: [{set, number, name}] }   (public read)
 * POST <url>  body: { token, changes: [{set, number, name, owned}] }
 */
const SHEET_NAME = 'Collection';
const HEADERS = ['set', 'number', 'name', 'added'];

/** Run this once from the editor. It creates the tab and logs your write token. */
function setup() {
  getSheet_();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid();
    props.setProperty('TOKEN', token);
  }
  Logger.log('Your write token: ' + token);
}

function doGet() {
  return json_({ ok: true, cards: readAll_() });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || body.token !== token) return json_({ ok: false, error: 'Wrong token' });
    const changed = applyChanges_(Array.isArray(body.changes) ? body.changes : []);
    return json_({ ok: true, changed });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  const sh = getSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues()
    .filter(r => r[0] && r[1])
    .map(([set, number, name]) => ({ set, number, name }));
}

function applyChanges_(changes) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    const data = last < 2 ? [] : sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    const index = new Map(data.map((r, i) => [r[0] + '|' + r[1], i]));
    const removed = new Set();
    let changed = 0;

    for (const c of changes) {
      if (!c || !c.set || c.number == null || c.number === '') continue;
      const key = c.set + '|' + c.number;
      if (c.owned && !index.has(key)) {
        index.set(key, data.length);
        data.push([String(c.set), String(c.number), c.name || '', new Date()]);
        changed++;
      } else if (!c.owned && index.has(key)) {
        removed.add(index.get(key));
        index.delete(key);
        changed++;
      }
    }
    if (!changed) return 0;

    // Rewrite the data block in one go (faster and simpler than row-by-row deletes).
    const rows = data.filter((_, i) => !removed.has(i));
    if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
    if (rows.length) {
      sh.getRange(2, 1, rows.length, 2).setNumberFormat('@'); // keep set codes and collector numbers as text
      sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    }
    return changed;
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
