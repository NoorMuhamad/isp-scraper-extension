/**
 * Receives ISP records from the Chrome extension and writes them into this
 * spreadsheet. Paste into Extensions → Apps Script of your sheet; see
 * README "Google Sheet setup".
 *
 * - Keeps every existing row and column. Matches the extension's fields to
 *   your columns by name (see COLUMNS aliases); adds a column at the end only
 *   for a field that has none.
 * - A business is matched by Place ID, then by its Maps feature id, then by
 *   normalized name + phone, the same phone number in the same city, or the
 *   same name in the same city, so rows you entered by hand match too.
 * - Updating a row fills empty cells and refreshes rating, reviews and the
 *   scrape date. It never overwrites a value already in the sheet otherwise:
 *   your corrections stay.
 * - Requests must carry the secret token set in Script properties (TOKEN).
 */

/** [field, header to create, other header names that mean the same thing] */
var COLUMNS = [
  ['name', 'ISP Name', ['isp name', 'name', 'business name', 'isp', 'company', 'company name', 'business']],
  ['phone', 'Phone', ['phone', 'phone number', 'primary phone', 'contact', 'contact number', 'mobile', 'number']],
  ['description', 'Description', ['description', 'business description', 'about']],
  ['city', 'City', ['city', 'town']],
  ['province', 'Province', ['province', 'state', 'territory', 'region']],
  ['address', 'Address', ['address', 'complete address', 'full address', 'location']],
  ['mapsUrl', 'Google Maps URL', ['google maps url', 'google maps link', 'maps url', 'maps link', 'map link', 'google maps']],
  ['website', 'Website', ['website', 'official website', 'web', 'url', 'site']],
  ['category', 'Category', ['category', 'business category', 'google category', 'type']],
  ['rating', 'Rating', ['rating', 'google rating', 'stars']],
  ['reviews', 'Reviews', ['reviews', 'review count', 'reviews count', 'no of reviews']],
  ['lat', 'Latitude', ['latitude', 'lat']],
  ['lng', 'Longitude', ['longitude', 'lng', 'long']],
  ['plusCode', 'Plus Code', ['plus code', 'pluscode']],
  ['placeId', 'Place ID', ['place id', 'google place id', 'placeid']],
  ['featureId', 'Maps Feature ID', ['maps feature id', 'feature id']],
  ['scrapedAt', 'Scraped At', ['scraped at', 'date scraped', 'scraped', 'last scraped', 'date and time scraped']],
];

/** Fields that change over time and are refreshed even when the cell has a value. */
var REFRESH = { rating: true, reviews: true, scrapedAt: true };

function doGet(e) {
  return respond(function () {
    var p = e.parameter || {};
    checkToken(p.token);
    var sheet = getSheet(p.sheetName);
    return { ok: true, sheet: sheet.getName(), rows: Math.max(sheet.getLastRow() - 1, 0), headers: headerRow(sheet) };
  });
}

function doPost(e) {
  return respond(function () {
    var body = JSON.parse(e.postData.contents);
    checkToken(body.token);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return upsert(getSheet(body.sheetName), body.records || []);
    } finally {
      lock.releaseLock();
    }
  });
}

function respond(fn) {
  var out;
  try {
    out = fn();
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected) throw new Error('Set the TOKEN script property first (Project Settings → Script properties).');
  if (token !== expected) throw new Error('Wrong token.');
}

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = name ? ss.getSheetByName(name) : ss.getSheets()[0];
  if (!sheet) throw new Error('No sheet named "' + name + '" in this spreadsheet.');
  return sheet;
}

function headerRow(sheet) {
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
}

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\((pvt|private)\.?\)|\b(pvt|private|ltd|limited|co|company|smc)\b\.?/g, ' ')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(s) {
  var d = String(s == null ? '' : s).replace(/\D/g, '');
  // 03001234567 and +923001234567 are the same number.
  if (d.indexOf('92') === 0) d = d.slice(2);
  if (d.indexOf('0') === 0) d = d.slice(1);
  return d;
}

/** Which column holds each field, adding the missing ones. Returns { field: columnIndex } (0-based). */
function mapColumns(sheet) {
  var headers = headerRow(sheet);
  var map = {};
  var used = {};
  COLUMNS.forEach(function (col) {
    var names = [norm(col[1])].concat(col[2].map(norm));
    for (var i = 0; i < headers.length; i++) {
      if (!used[i] && names.indexOf(norm(headers[i])) !== -1) {
        map[col[0]] = i;
        used[i] = true;
        return;
      }
    }
  });
  var missing = COLUMNS.filter(function (col) { return map[col[0]] === undefined; });
  if (missing.length) {
    var start = headers.length;
    sheet.getRange(1, start + 1, 1, missing.length).setValues([missing.map(function (c) { return c[1]; })]);
    missing.forEach(function (col, j) { map[col[0]] = start + j; });
  }
  return { map: map, width: headers.length + missing.length, added: missing.map(function (c) { return c[1]; }) };
}

function upsert(sheet, records) {
  var cols = mapColumns(sheet);
  var map = cols.map;
  var lastRow = sheet.getLastRow();
  var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, cols.width).getValues() : [];

  // Index existing rows by every way a business can be recognised.
  var index = {};
  var keysOf = function (get) {
    var keys = [];
    if (get('placeId')) keys.push('pid:' + get('placeId'));
    if (get('featureId')) keys.push('fid:' + get('featureId'));
    var name = normName(get('name'));
    var phone = digits(get('phone'));
    if (name && phone) keys.push('np:' + name + '|' + phone);
    // One phone number in one city is one business, even if the name is written differently.
    if (phone.length >= 9 && get('city')) keys.push('pc:' + phone + '|' + norm(get('city')));
    if (name && get('city')) keys.push('nc:' + name + '|' + norm(get('city')));
    return keys;
  };
  values.forEach(function (row, i) {
    keysOf(function (f) { return String(row[map[f]] || '').trim(); }).forEach(function (k) {
      if (index[k] === undefined) index[k] = i;
    });
  });

  var added = 0;
  var updated = 0;
  var unchanged = 0;
  var newRows = [];
  records.forEach(function (rec) {
    var get = function (f) { return String(rec[f] == null ? '' : rec[f]).trim(); };
    var keys = keysOf(get);
    var at;
    for (var k = 0; k < keys.length; k++) {
      if (index[keys[k]] !== undefined) { at = index[keys[k]]; break; }
    }
    if (at === undefined) {
      var row = new Array(cols.width).fill('');
      COLUMNS.forEach(function (col) { row[map[col[0]]] = cell(rec[col[0]]); });
      values.push(row);
      newRows.push(values.length - 1);
      keys.forEach(function (key) { index[key] = values.length - 1; });
      added++;
      return;
    }
    var existing = values[at];
    var changed = false;
    COLUMNS.forEach(function (col) {
      var field = col[0];
      var incoming = cell(rec[field]);
      if (incoming === '') return;
      var current = existing[map[field]];
      if (current === '' || current == null || (REFRESH[field] && String(current) !== String(incoming))) {
        existing[map[field]] = incoming;
        changed = true;
      }
    });
    if (changed) {
      sheet.getRange(at + 2, 1, 1, cols.width).setValues([existing]);
      updated++;
    } else {
      unchanged++;
    }
  });

  if (newRows.length) {
    var first = newRows[0];
    sheet.getRange(first + 2, 1, newRows.length, cols.width).setValues(values.slice(first));
  }
  return { ok: true, added: added, updated: updated, unchanged: unchanged, columnsAdded: cols.added };
}

/** A value for a cell. Text that a spreadsheet would treat as a formula is written as plain text. */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  var s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
