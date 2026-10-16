import { useEffect, useState } from "react";

const KEYS = ["settings", "cities", "cityStats", "run", "sync", "ownerSync", "errors", "recordCount"];

/** Live view of the worker's state: re-reads whenever storage changes. */
export function useStore() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => chrome.storage.local.get(KEYS).then((s) => alive && setState(s));
    load();
    const onChange = (changes, area) => {
      if (area === "local" && KEYS.some((k) => k in changes)) load();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);
  return state;
}

/** Send a command to the background worker; throws its error message. */
export async function command(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || "The extension did not answer.");
  return res;
}

export const formatWhen = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
