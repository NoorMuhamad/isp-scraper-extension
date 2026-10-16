/**
 * The scraper's engine. Owns all state (chrome.storage.local), runs the job
 * queue one search at a time in a dedicated Google Maps window, saves every
 * listing as it arrives, and syncs to the Google Sheet.
 *
 * Storage keys
 *   settings     user settings (shared/defaults.js)
 *   cities       { [cityId]: { name, province, enabled } }  — all start disabled
 *   cityStats    { [cityId]: { status, found, newLastRun, updatedLastRun, totalTasks, doneTasks, lastRunAt, lastError, failedKeywords } }
 *   run          { status: idle|running|paused, queue: [task], current, totalTasks, doneTasks, newThisRun, startedAt, lastSuccessfulRunAt }
 *   rec:<key>    one record per business; alias:<key> → primary key
 *   recordCount  number of unique businesses
 *   sync         { pending: [key], lastSyncAt, lastError, attempts, nextAttemptAt, added, updated }
 *   errors       last 100 errors, newest first
 *
 * The one hard rule: a city is scraped only while it is enabled. It is checked
 * when a run is queued, again before every search starts, and disabling a city
 * removes its queued searches and stops the one in progress.
 */
import { CITIES } from "../shared/cities.js";
import { DEFAULT_SETTINGS, RUN_IDLE } from "../shared/defaults.js";
import { cleanPlace, mergeRecord, recordAliases, recordChanged } from "../shared/records.js";

const store = chrome.storage.local;
const get = async (key, fallback) => (await store.get(key))[key] ?? fallback;

/** Serializes read-modify-write of storage. */
let lockChain = Promise.resolve();
function withLock(fn) {
  const result = lockChain.then(fn, fn);
  lockChain = result.catch(() => {});
  return result;
}

// ── Setup ───────────────────────────────────────────────────────────────────

async function ensureSetup() {
  await withLock(async () => {
    const cities = await get("cities", {});
    for (const c of CITIES) {
      if (!cities[c.id]) cities[c.id] = { name: c.name, province: c.province, enabled: false };
    }
    const saved = await get("settings", {});
    const settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      schedule: { ...DEFAULT_SETTINGS.schedule, ...(saved.schedule || {}) },
      sheet: { ...DEFAULT_SETTINGS.sheet, ...(saved.sheet || {}) },
    };
    await store.set({
      cities,
      settings,
      run: await get("run", RUN_IDLE),
      cityStats: await get("cityStats", {}),
      sync: await get("sync", { pending: [], added: 0, updated: 0 }),
      errors: await get("errors", []),
      recordCount: await get("recordCount", 0),
    });
  });
  await scheduleAlarms();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  void ensureSetup();
});
chrome.runtime.onStartup.addListener(() => void ensureSetup().then(kick));

async function scheduleAlarms() {
  const settings = await get("settings", DEFAULT_SETTINGS);
  // Watchdog: resumes a run if the worker was restarted, retries the sheet sync.
  await chrome.alarms.create("watchdog", { periodInMinutes: 1 });
  await chrome.alarms.clear("schedule");
  if (settings.schedule?.enabled && settings.schedule.everyHours > 0) {
    await chrome.alarms.create("schedule", { periodInMinutes: settings.schedule.everyHours * 60 });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "watchdog") {
    void kick();
    void flushSync(false);
  }
  if (alarm.name === "schedule") {
    const run = await get("run", RUN_IDLE);
    if (run.status === "idle") await startRun(null, "schedule");
  }
});

// ── Errors and stats ────────────────────────────────────────────────────────

async function logError(message, extra = {}) {
  await withLock(async () => {
    const errors = await get("errors", []);
    errors.unshift({ at: new Date().toISOString(), message, ...extra });
    await store.set({ errors: errors.slice(0, 100) });
  });
}

async function patchCity(cityId, patch) {
  await withLock(async () => {
    const cityStats = await get("cityStats", {});
    const prev = cityStats[cityId] || { found: 0, failedKeywords: [] };
    cityStats[cityId] = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
    await store.set({ cityStats });
  });
}

// ── Queue ───────────────────────────────────────────────────────────────────

const newTask = (cityId, keyword) => ({ id: crypto.randomUUID(), cityId, keyword, attempts: 0 });

/** Queue every keyword for the given cities (all enabled cities when null). Disabled cities are refused. */
async function startRun(cityIds, mode = "manual", keywords = null) {
  const added = await withLock(async () => {
    const [cities, settings, run, cityStats] = await Promise.all([
      get("cities", {}), get("settings", DEFAULT_SETTINGS), get("run", RUN_IDLE), get("cityStats", {}),
    ]);
    const wanted = (cityIds || Object.keys(cities)).filter((id) => cities[id]?.enabled);
    if (!wanted.length) return 0;
    const fresh = run.status === "idle";
    const queue = fresh ? [] : [...run.queue];
    const queued = new Set(queue.map((t) => `${t.cityId}|${t.keyword}`));
    let count = 0;
    for (const cityId of wanted) {
      let cityCount = 0;
      for (const keyword of keywords || settings.keywords) {
        if (queued.has(`${cityId}|${keyword}`)) continue;
        queue.push(newTask(cityId, keyword));
        cityCount += 1;
      }
      if (cityCount) {
        const prev = cityStats[cityId] || { found: 0, failedKeywords: [] };
        cityStats[cityId] = {
          ...prev,
          status: "queued",
          totalTasks: cityCount,
          doneTasks: 0,
          newLastRun: 0,
          updatedLastRun: 0,
          lastError: "",
          failedKeywords: keywords ? prev.failedKeywords.filter((k) => !keywords.includes(k)) : [],
        };
        count += cityCount;
      }
    }
    await store.set({
      cityStats,
      run: {
        ...(fresh ? RUN_IDLE : run),
        status: run.status === "paused" ? "paused" : "running",
        mode: fresh ? mode : run.mode,
        queue,
        totalTasks: (fresh ? 0 : run.totalTasks) + count,
        doneTasks: fresh ? 0 : run.doneTasks,
        newThisRun: fresh ? 0 : run.newThisRun,
        startedAt: fresh ? new Date().toISOString() : run.startedAt,
        lastSuccessfulRunAt: run.lastSuccessfulRunAt,
        hadErrors: fresh ? false : run.hadErrors,
      },
    });
    return count;
  });
  void kick();
  return added;
}

/** Remove all of a city's searches, including the one in progress, and stop it. */
async function dropCity(cityId, status, reason) {
  const stoppedCurrent = await withLock(async () => {
    const run = await get("run", RUN_IDLE);
    const removed = run.queue.filter((t) => t.cityId === cityId).length;
    const queue = run.queue.filter((t) => t.cityId !== cityId);
    await store.set({ run: { ...run, queue, totalTasks: Math.max(run.doneTasks, run.totalTasks - removed) } });
    return run.current?.cityId === cityId;
  });
  if (stoppedCurrent) await abortActive("city-stopped");
  await patchCity(cityId, { status, lastError: reason || "" });
}

// ── Runner ──────────────────────────────────────────────────────────────────

let loopActive = false;
/** The search in progress: resolves when the content script reports done/error/blocked. */
let active = null;

async function kick() {
  if (loopActive) return;
  loopActive = true;
  try {
    for (;;) {
      const run = await get("run", RUN_IDLE);
      if (run.status !== "running") break;
      const task = run.queue[0];
      if (!task) {
        await finishRun();
        break;
      }
      const cities = await get("cities", {});
      if (!cities[task.cityId]?.enabled) {
        // The rule: a disabled city is never processed, even if it was queued.
        await dropCity(task.cityId, "disabled", "");
        continue;
      }
      const outcome = await runTask(task, cities[task.cityId]);
      await afterTask(task, outcome);
    }
  } catch (error) {
    await logError(`Runner stopped: ${error.message}`);
  } finally {
    loopActive = false;
  }
}

async function finishRun() {
  await withLock(async () => {
    const run = await get("run", RUN_IDLE);
    await store.set({
      run: {
        ...run,
        status: "idle",
        current: null,
        finishedAt: new Date().toISOString(),
        lastSuccessfulRunAt: run.hadErrors ? run.lastSuccessfulRunAt : new Date().toISOString(),
      },
    });
  });
  void flushSync(true);
}

async function afterTask(task, outcome) {
  const settings = await get("settings", DEFAULT_SETTINGS);
  if (outcome.kind === "done") {
    let cityFinished = false;
    await withLock(async () => {
      const run = await get("run", RUN_IDLE);
      const queue = run.queue.filter((t) => t.id !== task.id);
      cityFinished = !queue.some((t) => t.cityId === task.cityId);
      await store.set({ run: { ...run, queue, current: null, doneTasks: run.doneTasks + 1 } });
    });
    await patchCity(task.cityId, (prev) => ({
      doneTasks: (prev.doneTasks || 0) + 1,
      ...(cityFinished
        ? { status: prev.failedKeywords?.length ? "failed" : "done", lastRunAt: new Date().toISOString() }
        : {}),
    }));
    void flushSync(false);
    return;
  }
  if (outcome.kind === "aborted") {
    await withLock(async () => {
      const run = await get("run", RUN_IDLE);
      await store.set({ run: { ...run, current: null } });
    });
    return;
  }
  if (outcome.kind === "blocked") {
    await withLock(async () => {
      const run = await get("run", RUN_IDLE);
      await store.set({ run: { ...run, status: "paused", current: null, blocked: true } });
    });
    const message =
      "Google is asking to confirm you are not a robot. Complete it yourself in the Google Maps window, then press Resume.";
    await patchCity(task.cityId, { status: "paused", lastError: message });
    await logError(message, { cityId: task.cityId, keyword: task.keyword });
    notify("Scraping paused", message);
    return;
  }
  // error: retry until maxAttempts, then mark this keyword failed for the city.
  const attempts = task.attempts + 1;
  const message = `${task.keyword}: ${outcome.message}`;
  await logError(outcome.message, { cityId: task.cityId, keyword: task.keyword, attempt: attempts });
  let cityFinished = false;
  await withLock(async () => {
    const run = await get("run", RUN_IDLE);
    let queue = run.queue.filter((t) => t.id !== task.id);
    if (attempts < settings.maxAttempts) queue = [...queue, { ...task, attempts }];
    cityFinished = !queue.some((t) => t.cityId === task.cityId);
    await store.set({
      run: {
        ...run,
        queue,
        current: null,
        hadErrors: true,
        doneTasks: attempts < settings.maxAttempts ? run.doneTasks : run.doneTasks + 1,
      },
    });
  });
  await patchCity(task.cityId, (prev) => ({
    lastError: message,
    ...(attempts >= settings.maxAttempts
      ? { failedKeywords: [...new Set([...(prev.failedKeywords || []), task.keyword])], doneTasks: (prev.doneTasks || 0) + 1 }
      : {}),
    ...(cityFinished ? { status: "failed", lastRunAt: new Date().toISOString() } : {}),
  }));
}

function notify(title, message) {
  try {
    chrome.notifications.create({ type: "basic", iconUrl: "image.png", title, message });
  } catch {
    /* notifications are a courtesy; the dashboard shows the same message */
  }
}

/** The Maps window the scraper works in. Reused while it stays open. */
async function ensureTab() {
  const { tabId } = await chrome.storage.session.get("tabId");
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) return tab.id;
    } catch {
      /* closed */
    }
  }
  const win = await chrome.windows.create({
    url: "https://www.google.com/maps?hl=en",
    focused: true,
    width: 1200,
    height: 850,
  });
  const id = win.tabs[0].id;
  await chrome.storage.session.set({ tabId: id });
  return id;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTabLoad(tabId, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "complete") return true;
    await sleep(500);
  }
  return false;
}

async function waitForContentScript(tabId, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (res?.ready) return true;
    } catch {
      /* not injected yet */
    }
    await sleep(700);
  }
  return false;
}

/** Ids of listings collected recently, which the page does not need to open again. */
async function freshIds(refreshAfterDays) {
  const all = await store.get(null);
  const cutoff = Date.now() - refreshAfterDays * 86400000;
  const ids = [];
  for (const [key, rec] of Object.entries(all)) {
    if (!key.startsWith("rec:") || !rec?.scrapedAt) continue;
    if (Date.parse(rec.scrapedAt) < cutoff) continue;
    if (rec.featureId) ids.push(rec.featureId);
    if (rec.placeId) ids.push(rec.placeId);
  }
  return ids;
}

/**
 * Whether this search may still run: the run is going, the task is still
 * queued, and its city is still enabled. Checked again right before scraping,
 * because pausing or disabling can happen while the Maps page is loading.
 */
async function stillWanted(task) {
  const [run, cities] = await Promise.all([get("run", RUN_IDLE), get("cities", {})]);
  return run.status === "running" && run.queue.some((t) => t.id === task.id) && !!cities[task.cityId]?.enabled;
}

async function runTask(task, city) {
  const settings = await get("settings", DEFAULT_SETTINGS);
  await withLock(async () => {
    const run = await get("run", RUN_IDLE);
    await store.set({ run: { ...run, current: { ...task, cityName: city.name, startedAt: new Date().toISOString(), saved: 0 } } });
  });
  await patchCity(task.cityId, { status: "running" });

  let tabId;
  try {
    if (!(await stillWanted(task))) return { kind: "aborted", reason: "no-longer-wanted" };
    tabId = await ensureTab();
    // Stop anything still running in the page from an earlier worker.
    await chrome.tabs.sendMessage(tabId, { type: "ABORT" }).catch(() => {});
    const query = `${task.keyword} in ${city.name}, Pakistan`;
    await chrome.tabs.update(tabId, { url: `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en` });
    await sleep(800);
    if (!(await waitForTabLoad(tabId, 45000))) return { kind: "error", message: "Google Maps did not finish loading." };
    if (!(await waitForContentScript(tabId, 20000))) {
      return { kind: "error", message: "The scraper could not start in the Google Maps page." };
    }
  } catch (error) {
    return { kind: "error", message: error.message };
  }

  if (!(await stillWanted(task))) return { kind: "aborted", reason: "no-longer-wanted" };
  const skip = await freshIds(settings.refreshAfterDays);
  return new Promise((resolve) => {
    const watchdog = setInterval(() => {
      if (active && Date.now() - active.lastSeen > settings.stallTimeoutMs) {
        finishActive({ kind: "error", message: `No progress for ${Math.round(settings.stallTimeoutMs / 1000)} seconds.` });
      }
    }, 5000);
    active = { taskId: task.id, cityId: task.cityId, keyword: task.keyword, tabId, lastSeen: Date.now(), resolve, watchdog };
    chrome.tabs
      .sendMessage(tabId, {
        type: "RUN_SEARCH",
        taskId: task.id,
        cityId: task.cityId,
        keyword: task.keyword,
        max: settings.maxPerSearch,
        pauseMs: settings.pauseBetweenPlacesMs,
        skip,
      })
      .catch((error) => finishActive({ kind: "error", message: error.message }));
  });
}

function finishActive(outcome) {
  if (!active) return;
  const { resolve, watchdog } = active;
  clearInterval(watchdog);
  active = null;
  resolve(outcome);
}

async function abortActive(reason) {
  if (!active) return;
  const { tabId } = active;
  await chrome.tabs.sendMessage(tabId, { type: "ABORT" }).catch(() => {});
  finishActive({ kind: "aborted", reason });
}

// ── Saving listings ─────────────────────────────────────────────────────────

async function savePlace(msg) {
  let newRecord = false;
  await withLock(async () => {
    const cities = await get("cities", {});
    const city = cities[msg.cityId];
    if (!city) return;
    const fresh = cleanPlace(msg.place, city, msg.keyword);
    if (!fresh.name) return;

    // Find the business under any key it may have been stored with before.
    const aliases = recordAliases(fresh);
    const found = await store.get(aliases.map((k) => `alias:${k}`));
    const primary = Object.values(found)[0] || aliases[0];
    const existing = await get(`rec:${primary}`, null);

    const record = existing ? mergeRecord(existing, fresh) : { ...fresh, firstSeenAt: fresh.scrapedAt };
    record.key = primary;
    const writes = { [`rec:${primary}`]: record };
    for (const k of recordAliases(record)) writes[`alias:${k}`] = primary;

    const [cityStats, run, sync, recordCount] = await Promise.all([
      get("cityStats", {}), get("run", RUN_IDLE), get("sync", { pending: [] }), get("recordCount", 0),
    ]);
    const stats = cityStats[msg.cityId] || { found: 0, failedKeywords: [] };
    if (!existing) {
      newRecord = true;
      // A business counts towards the city it was first found in.
      stats.found = (stats.found || 0) + 1;
      stats.newLastRun = (stats.newLastRun || 0) + 1;
      writes.recordCount = recordCount + 1;
      writes.run = { ...run, newThisRun: (run.newThisRun || 0) + 1 };
    } else {
      stats.updatedLastRun = (stats.updatedLastRun || 0) + 1;
    }
    if (writes.run?.current || run.current) {
      const r = writes.run || run;
      writes.run = { ...r, current: r.current ? { ...r.current, saved: (r.current.saved || 0) + 1 } : null };
    }
    cityStats[msg.cityId] = stats;
    writes.cityStats = cityStats;
    if (!existing || recordChanged(existing, record)) {
      writes.sync = { ...sync, pending: [...new Set([...(sync.pending || []), primary])] };
    }
    await store.set(writes);
  });
  const sync = await get("sync", { pending: [] });
  const settings = await get("settings", DEFAULT_SETTINGS);
  if ((sync.pending || []).length >= (settings.sheet?.batchSize || 25)) void flushSync(false);
  return newRecord;
}

// ── Google Sheet sync ───────────────────────────────────────────────────────

let syncing = false;

/**
 * Send pending records to the Apps Script attached to the sheet, in batches.
 * Failures back off (30s, 1m, 2m … up to 30m) and keep the records pending.
 */
async function flushSync(force) {
  if (syncing) return;
  const settings = await get("settings", DEFAULT_SETTINGS);
  const { webhookUrl, token, sheetName, batchSize } = settings.sheet || {};
  if (!webhookUrl) return;
  const state = await get("sync", { pending: [] });
  if (!state.pending?.length) return;
  if (!force && state.nextAttemptAt && Date.now() < state.nextAttemptAt) return;

  syncing = true;
  try {
    for (;;) {
      const current = await get("sync", { pending: [] });
      const batch = (current.pending || []).slice(0, batchSize || 25);
      if (!batch.length) break;
      const stored = await store.get(batch.map((k) => `rec:${k}`));
      const records = batch.map((k) => stored[`rec:${k}`]).filter(Boolean);
      const res = await fetch(webhookUrl, {
        method: "POST",
        // text/plain keeps this a simple request for Apps Script.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "upsert", token, sheetName, records }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Sheet answered HTTP ${res.status}`);
      await withLock(async () => {
        const s = await get("sync", { pending: [] });
        const sent = new Set(batch);
        await store.set({
          sync: {
            ...s,
            pending: (s.pending || []).filter((k) => !sent.has(k)),
            added: (s.added || 0) + (body.added || 0),
            updated: (s.updated || 0) + (body.updated || 0),
            lastSyncAt: new Date().toISOString(),
            lastError: "",
            attempts: 0,
            nextAttemptAt: 0,
          },
        });
      });
    }
  } catch (error) {
    await withLock(async () => {
      const s = await get("sync", { pending: [] });
      const attempts = (s.attempts || 0) + 1;
      await store.set({
        sync: {
          ...s,
          attempts,
          lastError: error.message,
          nextAttemptAt: Date.now() + Math.min(30000 * 2 ** (attempts - 1), 30 * 60000),
        },
      });
    });
    await logError(`Google Sheet sync failed: ${error.message}`);
  } finally {
    syncing = false;
  }
}

async function testSheet(sheet) {
  if (!sheet?.webhookUrl) throw new Error("Paste the Apps Script web app URL first.");
  const url = new URL(sheet.webhookUrl);
  url.searchParams.set("action", "ping");
  url.searchParams.set("token", sheet.token || "");
  url.searchParams.set("sheetName", sheet.sheetName || "");
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Sheet answered HTTP ${res.status}`);
  return body;
}

// ── Messages ────────────────────────────────────────────────────────────────

async function handleCommand(msg) {
  switch (msg.type) {
    case "SET_CITIES_ENABLED": {
      await withLock(async () => {
        const cities = await get("cities", {});
        for (const id of msg.ids) if (cities[id]) cities[id] = { ...cities[id], enabled: !!msg.enabled };
        await store.set({ cities });
      });
      if (!msg.enabled) for (const id of msg.ids) await dropCity(id, "disabled", "");
      return {};
    }
    case "START":
      return { queued: await startRun(msg.cityIds || null, "manual") };
    case "STOP_CITY":
      await dropCity(msg.cityId, "stopped", "");
      return {};
    case "PAUSE":
      await withLock(async () => {
        const run = await get("run", RUN_IDLE);
        if (run.status === "running") await store.set({ run: { ...run, status: "paused" } });
      });
      // The current search stops; it stays first in the queue and resumes,
      // skipping the listings it already saved.
      await abortActive("paused");
      return {};
    case "RESUME":
      await withLock(async () => {
        const run = await get("run", RUN_IDLE);
        if (run.status === "paused") await store.set({ run: { ...run, status: "running", blocked: false } });
      });
      void kick();
      return {};
    case "STOP": {
      const run = await get("run", RUN_IDLE);
      const cityIds = [...new Set(run.queue.map((t) => t.cityId))];
      await withLock(async () => {
        const r = await get("run", RUN_IDLE);
        await store.set({ run: { ...r, status: "idle", queue: [], current: null } });
      });
      await abortActive("stopped");
      for (const id of cityIds) await patchCity(id, { status: "stopped" });
      return {};
    }
    case "RETRY_FAILED": {
      const cityStats = await get("cityStats", {});
      let queued = 0;
      for (const [cityId, s] of Object.entries(cityStats)) {
        if (s.failedKeywords?.length) queued += await startRun([cityId], "manual", s.failedKeywords);
      }
      return { queued };
    }
    case "SAVE_SETTINGS":
      await withLock(async () => {
        const settings = await get("settings", DEFAULT_SETTINGS);
        await store.set({ settings: { ...settings, ...msg.settings } });
      });
      await scheduleAlarms();
      return {};
    case "TEST_SHEET":
      return await testSheet(msg.sheet);
    case "SYNC_NOW":
      await flushSync(true);
      return { sync: await get("sync", {}) };
    case "CLEAR_ERRORS":
      await store.set({ errors: [] });
      return {};
    default:
      throw new Error(`Unknown command ${msg.type}`);
  }
}

async function handleContent(msg) {
  if (msg.type === "PLACE") {
    if (active?.taskId === msg.taskId) active.lastSeen = Date.now();
    await savePlace(msg);
    return;
  }
  if (!active || active.taskId !== msg.taskId) return;
  active.lastSeen = Date.now();
  if (msg.type === "SEARCH_DONE") finishActive({ kind: msg.reason === "aborted" ? "aborted" : "done", reason: msg.reason });
  if (msg.type === "SEARCH_ERROR") finishActive({ kind: "error", message: msg.message });
  if (msg.type === "BLOCKED") finishActive({ kind: "blocked" });
  if (msg.type === "WARN") void logError(msg.message, { cityId: active?.cityId, keyword: active?.keyword });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab) {
    handleContent(msg).catch((error) => logError(error.message));
    return false;
  }
  handleCommand(msg).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});

// A restarted worker picks the run back up.
void ensureSetup().then(kick);
