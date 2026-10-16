# ISP Finder: Pakistan (Chrome extension)

Finds internet service providers on Google Maps for the Pakistani cities you
switch on, saves them without duplicates, and sends them to your Google Sheet.

It runs in your own Chrome: it opens a Google Maps window, searches
"<keyword> in <City>, Pakistan" for each keyword, opens each listing to read its
details, and moves on to the next search.

## Install

```bash
npm ci
npm run build
```

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** → choose the `dist` folder.
3. Click the extension's icon: the side panel opens.

After changing the code, run `npm run build` again and press the reload icon on the extension's card.

## Google Sheet setup (one time)

The extension sends records to a small Apps Script attached to your sheet, so
no Google Cloud project or API key is needed.

1. Open your sheet → **Extensions → Apps Script**.
2. Replace the editor's contents with `apps-script/Code.gs` and save.
3. **Project Settings → Script properties → Add property**: `TOKEN` = a long random value (for example from a password generator).
4. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy, allow the permissions, copy the **Web app URL**.
5. In the extension: **Settings → Google Sheet**: paste the URL, the same token, and the name of the tab to write to (e.g. `ISPs`). **Save settings**, then **Test sheet connection**.

"Anyone" means anyone with the URL can call it, which is why every request must carry the token. Keep both private.
After editing `Code.gs`, use **Deploy → Manage deployments → Edit → New version**, or the old code keeps running.

### How the sheet is updated

- Existing rows and columns are kept. Fields are matched to your columns by name
  ("ISP Name", "Name", "Company"…, "Phone", "Contact Number"…; full list in `COLUMNS` in `Code.gs`).
  A column is added at the end only for a field that has none.
- A business is recognised by Google's place ID, then Maps feature ID, then
  name + phone, phone + city, or name + city, so rows you typed yourself are matched too.
- A known business is updated, not added again: empty cells are filled and
  rating, reviews and "Scraped At" are refreshed. Values you have typed are never overwritten.
- If the sheet can't be reached, records wait and are retried (30 s, 1 min, 2 min … up to every 30 min).
  The Dashboard shows the error and has **Sync now**.

## Using it

- **Cities**: every city starts **off**. Switch on cities (or a whole province with
  the switch in its header). Start one city with ▶, stop it with ■.
- **Dashboard**: **Start enabled cities**, **Pause**, **Resume**, **Stop**, **Retry failed**,
  progress, the current search, sheet sync, errors, and **Download CSV** of everything collected.
- **Settings**: keywords (one per line), listings per search, pace, retries,
  "re-open after" days, the schedule, and the sheet connection.

**Only enabled cities are ever scraped.** This is checked when a run is queued,
again before each search's page is loaded, and again right before scraping it.
Switching a city off removes its queued searches and stops the one in progress.
Scheduled and resumed runs follow the same rule.

Pause stops after the listing in hand; Resume continues that search and skips
the listings already saved. A run survives the extension restarting: progress,
city settings and collected records are kept in Chrome's storage.

### Keep in mind

- Chrome must be open for runs and schedules to happen, and the Google Maps
  window should stay open and not minimised: Chrome slows down hidden pages a lot.
- Searches run one at a time in one window, with a pause after each listing
  (Settings). Expect roughly 4–6 seconds per new listing.
- If Google asks you to confirm you're not a robot, the run **pauses** and tells
  you. Complete it yourself in the Maps window, then press **Resume**. The
  extension never tries to get past it.
- Google Maps changes its page from time to time. If listings stop being read,
  searches fail with "Google Maps may have changed its page" rather than finishing
  silently empty. The selectors are in `src/content/content-script.js` (`readDetails`).
- Collecting data from Google Maps this way is against Google's Terms of Service.
  Heavy use can lead to robot checks or temporary blocks for your IP or Google account.

## Fields

| Field | From | Notes |
|---|---|---|
| ISP name, address, phone, website, category | The listing's page | Empty when the listing has none |
| Rating, reviews | The listing's page | |
| Description | Google's short summary of the business | Most small ISPs don't have one, so usually empty |
| City, province | The city that was searched | A business found in several cities' searches keeps the first |
| Latitude, longitude, Plus Code | The listing's address / page | |
| Google Maps URL, Place ID, Maps feature ID | The listing's link | Used to recognise duplicates |
| Scraped at | When it was read | |

Nothing is invented: a value that isn't on the listing stays empty.

## Code

| Path | What |
|---|---|
| `src/background/service-worker.js` | The engine: job queue, city rules, saving, retries, schedule, sheet sync |
| `src/content/content-script.js` | Runs inside Google Maps; reads the results and each listing |
| `src/shared/records.js` | Cleaning, phone format, duplicate keys, merging, CSV |
| `src/shared/cities.js` | The city list (add a city here) |
| `src/components/` | The side panel: Dashboard, Cities, Settings |
| `apps-script/Code.gs` | Runs in your Google Sheet; writes and updates rows |
