/**
 * Runs inside Google Maps. Given one search (already loaded by the background
 * worker), it walks the results list, opens each listing to read its details,
 * and reports every listing to the worker as soon as it is read.
 *
 * Self-contained on purpose: Chrome does not allow imports in content scripts.
 *
 * Reading the page relies first on Google's data attributes (data-item-id
 * "address", "phone:tel:…", "authority", "oloc"), which are steadier and
 * language-independent, and only then on visible text. If Google shows a
 * "confirm you're not a robot" page, the run is paused for the user; the
 * scraper never tries to get past it.
 */
(() => {
  if (window.__ispScraperLoaded) return;
  window.__ispScraperLoaded = true;

  let job = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  async function waitFor(check, timeoutMs, stepMs = 300) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (job?.aborted) return null;
      const value = check();
      if (value) return value;
      await sleep(stepMs);
    }
    return null;
  }

  const textOf = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
  /** "Address: 12 Main Rd" → "12 Main Rd" */
  const afterLabel = (label) => (label || "").replace(/^[^:]{1,40}:\s*/, "").trim();

  function ids(url) {
    const s = String(url || "");
    return {
      featureId: (s.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || [])[1] || "",
      placeId: decodeURIComponent((s.match(/!19s(ChI[A-Za-z0-9_-]+)/) || [])[1] || ""),
    };
  }

  function isBlocked() {
    if (location.pathname.startsWith("/sorry")) return true;
    if (document.querySelector('iframe[src*="recaptcha"], form#captcha-form')) return true;
    const top = (document.body?.innerText || "").slice(0, 3000);
    return /unusual traffic|not a robot/i.test(top);
  }

  const feed = () => document.querySelector('div[role="feed"]');

  /** The open listing's panel: the main region that has the business name as its heading. */
  function detailPane() {
    return [...document.querySelectorAll('div[role="main"]')].find((m) => m.querySelector("h1")) || null;
  }

  function cleanWebsite(href) {
    if (!href) return "";
    try {
      const u = new URL(href, location.href);
      if (u.hostname.endsWith("google.com") && u.pathname === "/url") return u.searchParams.get("q") || "";
      return u.href;
    } catch {
      return href;
    }
  }

  function readDetails() {
    const pane = detailPane();
    if (!pane) return null;
    const attr = (sel, name) => pane.querySelector(sel)?.getAttribute(name) || "";

    const phoneId = attr('[data-item-id^="phone:tel:"]', "data-item-id");
    const ratingLabel = attr('[role="img"][aria-label*="star" i]', "aria-label");
    const reviewsLabel = [...pane.querySelectorAll("[aria-label]")]
      .map((el) => el.getAttribute("aria-label"))
      .find((label) => /^[\d,.]+\s+reviews?$/i.test(label || ""));
    const coords = location.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);

    return {
      name: textOf(pane.querySelector("h1")),
      address:
        afterLabel(attr('[data-item-id="address"]', "aria-label")) || textOf(pane.querySelector('[data-item-id="address"]')),
      phone: phoneId ? phoneId.slice("phone:tel:".length) : "",
      website: cleanWebsite(attr('a[data-item-id="authority"]', "href")),
      plusCode: afterLabel(attr('[data-item-id="oloc"]', "aria-label")),
      category: textOf(pane.querySelector('button[jsaction*="category"]')),
      rating: (ratingLabel.match(/[\d.]+/) || [""])[0],
      reviews: reviewsLabel ? reviewsLabel.replace(/[^\d]/g, "") : "",
      // Google's own short description; most small ISPs do not have one.
      description: textOf(pane.querySelector(".PYvSYb")),
      lat: coords ? coords[1] : "",
      lng: coords ? coords[2] : "",
      ...ids(location.href),
    };
  }

  async function backToResults() {
    const back =
      document.querySelector('button[aria-label="Back"]') || document.querySelector('button[jsaction*="back"]');
    if (back) back.click();
    else history.back();
    return waitFor(() => feed(), 10000);
  }

  function endOfList() {
    const f = feed();
    return !!f && /reached the end of the list/i.test(f.innerText.slice(-600));
  }

  async function runSearch(j) {
    job = { ...j, aborted: false };
    const base = { taskId: j.taskId, cityId: j.cityId, keyword: j.keyword };
    const heartbeat = setInterval(() => send({ ...base, type: "HEARTBEAT" }), 10000);
    const done = (reason) => send({ ...base, type: "SEARCH_DONE", reason });
    const fail = (message) => send({ ...base, type: "SEARCH_ERROR", message });
    try {
      // Results, a single business, "no results", or a robot check.
      const state = await waitFor(() => {
        if (isBlocked()) return "blocked";
        if (feed()) return "feed";
        if (location.pathname.includes("/place/") && detailPane()) return "place";
        if (/Google Maps can't find|No results found/i.test(document.body?.innerText?.slice(0, 4000) || "")) return "none";
        return null;
      }, 25000);
      if (job.aborted) return done("aborted");
      if (state === "blocked") return send({ ...base, type: "BLOCKED" });
      if (state === "none") return done("no-results");
      if (!state) return fail("The search results did not appear within 25 seconds.");

      if (state === "place") {
        await sleep(800);
        const details = readDetails();
        if (details?.name) send({ ...base, type: "PLACE", place: { ...details, mapsUrl: location.href } });
        return done("single-result");
      }

      const skip = new Set(j.skip || []);
      const visited = new Set();
      let saved = 0;
      let idle = 0;
      let unreadable = 0;

      while (!job.aborted && saved < j.max) {
        if (isBlocked()) return send({ ...base, type: "BLOCKED" });
        const list = feed();
        if (!list) {
          if (!(await backToResults())) return fail("Lost the results list and could not get back to it.");
          continue;
        }

        const next = [...list.querySelectorAll('a[href*="/maps/place/"]')].find((a) => !visited.has(a.href));
        if (!next) {
          if (endOfList() || idle >= 6) break;
          const before = list.querySelectorAll('a[href*="/maps/place/"]').length;
          list.scrollBy(0, 2000);
          await sleep(1500);
          const after = feed()?.querySelectorAll('a[href*="/maps/place/"]').length || 0;
          idle = after > before ? 0 : idle + 1;
          continue;
        }

        visited.add(next.href);
        const listing = ids(next.href);
        // Collected recently: no need to open it again.
        if (skip.has(listing.featureId) || (listing.placeId && skip.has(listing.placeId))) continue;

        const cardName = next.getAttribute("aria-label") || "";
        next.click();
        const opened = await waitFor(() => {
          const pane = detailPane();
          const heading = textOf(pane?.querySelector("h1"));
          if (!heading) return null;
          return !listing.featureId || location.href.includes(listing.featureId) ? pane : null;
        }, 12000);
        if (job.aborted) break;

        if (opened) {
          await sleep(700); // let the phone/website rows render
          const details = readDetails() || {};
          const place = {
            ...details,
            name: details.name || cardName,
            featureId: details.featureId || listing.featureId,
            placeId: details.placeId || listing.placeId,
            mapsUrl: next.href.split("?")[0],
          };
          send({ ...base, type: "PLACE", place });
          saved += 1;
          unreadable = 0;
        } else {
          unreadable += 1;
          send({ ...base, type: "WARN", message: `Could not open "${cardName || next.href}".` });
          // Google changed the page, or the listings will not open: say so instead of silently finishing.
          if (unreadable >= 5) return fail("Five listings in a row would not open. Google Maps may have changed its page.");
        }

        // Only go back if the listing actually opened; pressing back from the
        // results list would leave the search altogether.
        if (!feed() && !(await backToResults())) return fail("Could not return to the results list.");
        await sleep(j.pauseMs);
      }

      if (job.aborted) return done("aborted");
      if (saved === 0 && visited.size > 0 && visited.size === unreadable) {
        return fail("Listings were found but none could be read. Google Maps may have changed its page.");
      }
      return done(saved >= j.max ? "max-reached" : "end-of-list");
    } catch (error) {
      return fail(error.message);
    } finally {
      clearInterval(heartbeat);
      job = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ ready: true, busy: !!job });
      return false;
    }
    if (msg.type === "ABORT") {
      if (job) job.aborted = true;
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "RUN_SEARCH") {
      if (job) {
        sendResponse({ ok: false, error: "busy" });
        return false;
      }
      void runSearch(msg);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
