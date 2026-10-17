/**
 * Turning what the content script read from a Maps listing into a clean,
 * deduplicated record. Pure functions: used by the background worker and
 * tested on their own.
 */

/** Pakistani numbers in one form: +92XXXXXXXXXX. Anything else is kept as written. */
export function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/[^\d+]/g, "");
  if (/^\+92\d{9,11}$/.test(digits)) return digits;
  if (/^0092\d{9,11}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^92\d{9,11}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9,11}$/.test(digits)) return `+92${digits.slice(1)}`;
  return s;
}

/** Name for comparison: lowercase, no punctuation or company suffixes. */
export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\((pvt|private)\.?\)|\b(pvt|private|ltd|limited|co|company|smc)\b\.?/g, " ")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function websiteHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Google's ids inside a Maps place URL. */
export function idsFromMapsUrl(url) {
  const s = String(url || "");
  const featureId = (s.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || [])[1] || "";
  const placeId = decodeURIComponent((s.match(/!19s(ChI[A-Za-z0-9_-]+)/) || [])[1] || "");
  return { featureId, placeId };
}

/**
 * The record's identity. Google's place id when there is one, then the Maps
 * feature id (always in the listing link), and only as a last resort the
 * normalized name + phone + website + city.
 */
export function recordKey(r) {
  if (r.placeId) return `pid:${r.placeId}`;
  if (r.featureId) return `fid:${r.featureId}`;
  return `cmp:${[normalizeName(r.name), String(r.phone || "").replace(/\D/g, ""), websiteHost(r.website), normalizeName(r.city)].join("|")}`;
}

/** All keys a record can be found under, so a later visit with more ids still matches. */
export function recordAliases(r) {
  const keys = new Set([recordKey(r)]);
  if (r.featureId) keys.add(`fid:${r.featureId}`);
  if (r.placeId) keys.add(`pid:${r.placeId}`);
  if (r.name && (r.phone || r.website)) {
    keys.add(recordKey({ name: r.name, phone: r.phone, website: r.website, city: r.city }));
  }
  return [...keys];
}

const FIELDS = [
  "name", "phone", "description", "category", "address", "website", "rating", "reviews",
  "lat", "lng", "plusCode", "mapsUrl", "placeId", "featureId",
];

/** Clean one listing read from the page. Missing values stay empty; nothing is invented. */
export function cleanPlace(place, city, keyword, now = new Date()) {
  const t = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
  const ids = idsFromMapsUrl(place.mapsUrl);
  const rating = parseFloat(t(place.rating));
  const reviews = parseInt(t(place.reviews).replace(/[^\d]/g, ""), 10);
  // The listing link carries the coordinates too (!3d<lat>!4d<lng>).
  const fromUrl = String(place.mapsUrl || "").match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || [];
  const lat = parseFloat(place.lat || fromUrl[1]);
  const lng = parseFloat(place.lng || fromUrl[2]);
  return {
    name: t(place.name),
    phone: normalizePhone(place.phone),
    description: t(place.description),
    category: t(place.category),
    address: t(place.address),
    website: t(place.website),
    rating: Number.isFinite(rating) ? rating : "",
    reviews: Number.isFinite(reviews) ? reviews : "",
    lat: Number.isFinite(lat) ? lat : "",
    lng: Number.isFinite(lng) ? lng : "",
    plusCode: t(place.plusCode),
    mapsUrl: t(place.mapsUrl),
    placeId: t(place.placeId) || ids.placeId,
    featureId: t(place.featureId) || ids.featureId,
    city: city.name,
    province: city.province,
    keyword,
    scrapedAt: now.toISOString(),
  };
}

/**
 * A newer visit of a known listing: fresh values replace old ones, but an
 * empty value never wipes one we had. The city it was first found in stays.
 */
export function mergeRecord(old, fresh) {
  const out = { ...old };
  for (const f of FIELDS) if (fresh[f] !== "" && fresh[f] != null) out[f] = fresh[f];
  out.scrapedAt = fresh.scrapedAt;
  out.firstSeenAt = old.firstSeenAt || old.scrapedAt;
  return out;
}

/** True when the merge changed something worth sending to the sheet. */
export function recordChanged(before, after) {
  return FIELDS.some((f) => String(before[f] ?? "") !== String(after[f] ?? ""));
}

export const CSV_COLUMNS = [
  ["name", "ISP Name"], ["phone", "Phone"], ["description", "Description"], ["city", "City"],
  ["province", "Province"], ["address", "Address"], ["mapsUrl", "Google Maps URL"], ["website", "Website"],
  ["category", "Category"], ["rating", "Rating"], ["reviews", "Reviews"], ["lat", "Latitude"],
  ["lng", "Longitude"], ["plusCode", "Plus Code"], ["placeId", "Place ID"], ["scrapedAt", "Scraped At"],
];

/** CSV text. Values that a spreadsheet would run as a formula are prefixed with ' . */
export function toCsv(records) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [CSV_COLUMNS.map(([, h]) => cell(h)).join(",")];
  for (const r of records) lines.push(CSV_COLUMNS.map(([k]) => cell(r[k])).join(","));
  return lines.join("\r\n");
}

// ── Is this listing an ISP? ─────────────────────────────────────────────────
// Google Maps answers "internet provider in <city>" with SEO agencies,
// software houses, computer shops and the like. Only ISPs are kept. The same
// rules run in the owner backend (prospects/isp-check.ts): keep the two alike.

/** Google categories that mean an ISP. */
const ISP_CATEGORIES = /^(internet service provider|cable company|internet service|broadband provider|wireless internet service provider)$/i;
/** Categories an ISP is sometimes filed under: kept only when the name says ISP too. */
const MAYBE_CATEGORIES = /^(|wi-?fi spot|telecommunications|telecommunications service provider|telecommunications company|telecommunications contractor|cable tv|satellite communication service|communications|store|service establishment|corporate office)$/i;
/** Words in a name that say ISP. */
const ISP_NAME = /internet|broad\s?band|\bisp\b|isp\b|fib(?:er|re)|ftth|gpon|wi-?fi|wireless|\bnet\b|net\s?works?|cable|cabel|\bnbb\b|cyber\s?net/i;
/** Words in a name that say it is something else, even when Google files it as an ISP. */
const NOT_ISP_NAME =
  /\bseo\b|marketing|marketer|digital agency|ads agency|web\s?(?:site)?\s?(?:design|develop)|website|developer|hosting|domain|software|freelanc|mail\s?box|temp\s?mail|converter|\bhtml\b|\bxml\b|app development|graphic|printing|photo\s?stat|training|institute|academy|course|school|college|mobile (?:shop|accessories|zone)|laptop|coworking|incubator/i;
/** Mobile-network franchises (Zong, Jazz...) unless the name also says internet/fiber. */
const MOBILE_FRANCHISE = /\b(?:zong|jazz|telenor|ufone|mobilink|onic)\b|franchise/i;

/** { isp, reason }: whether a cleaned record is an ISP, and why not. */
export function ispCheck(r) {
  const name = String(r.name || "").trim();
  const category = String(r.category || "").trim();
  if (!name || /^results?$/i.test(name)) return { isp: false, reason: "No business name" };
  if (NOT_ISP_NAME.test(name)) return { isp: false, reason: `Name looks like a non-ISP (${category || "no category"})` };
  const ispName = ISP_NAME.test(name);
  if (MOBILE_FRANCHISE.test(name) && !/internet|broad\s?band|fib(?:er|re)|wi-?fi/i.test(name)) {
    return { isp: false, reason: "Mobile network franchise" };
  }
  if (ISP_CATEGORIES.test(category)) return { isp: true, reason: "" };
  if (MAYBE_CATEGORIES.test(category) && ispName) return { isp: true, reason: "" };
  return { isp: false, reason: category ? `Category “${category}” is not an ISP` : "No category and the name doesn't say ISP" };
}
