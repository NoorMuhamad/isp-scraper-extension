import { useState } from "react";
import { Alert, Button, FormControlLabel, Stack, Switch, TextField, Typography } from "@mui/material";
import { command } from "./useStore";

const num = (v, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || min));

export default function Settings({ settings, onError }) {
  // The tab renders only once settings have loaded, so the form starts from them.
  const [form, setForm] = useState(() => ({ ...settings, keywordsText: settings.keywords.join("\n") }));
  const [notice, setNotice] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setSheet = (patch) => setForm((f) => ({ ...f, sheet: { ...f.sheet, ...patch } }));
  const setOwner = (patch) => setForm((f) => ({ ...f, owner: { ...f.owner, ...patch } }));

  const toSave = () => ({
    keywords: [...new Set(form.keywordsText.split("\n").map((k) => k.trim()).filter(Boolean))],
    maxPerSearch: num(form.maxPerSearch, 1, 200),
    pauseBetweenPlacesMs: num(form.pauseBetweenPlacesMs, 500, 60000),
    stallTimeoutMs: num(form.stallTimeoutMs, 30000, 600000),
    maxAttempts: num(form.maxAttempts, 1, 10),
    refreshAfterDays: num(form.refreshAfterDays, 0, 365),
    schedule: { enabled: !!form.schedule.enabled, everyHours: num(form.schedule.everyHours, 1, 24 * 60) },
    sheet: { ...form.sheet, webhookUrl: form.sheet.webhookUrl.trim(), batchSize: num(form.sheet.batchSize, 1, 200) },
    owner: { ...form.owner, url: form.owner.url.trim().replace(/\/+$/, ""), key: form.owner.key.trim(), batchSize: num(form.owner.batchSize, 1, 200) },
  });

  const save = async () => {
    const values = toSave();
    if (!values.keywords.length) return onError("Add at least one search keyword.");
    try {
      await command("SAVE_SETTINGS", { settings: values });
      setNotice({ severity: "success", text: "Saved." });
    } catch (e) {
      onError(e.message);
    }
  };

  const testOwner = async () => {
    try {
      const res = await command("TEST_OWNER", { owner: toSave().owner });
      setNotice({ severity: "success", text: `Connected to the owner panel (key “${res.key}”).` });
    } catch (e) {
      setNotice({ severity: "error", text: e.message });
    }
  };

  const test = async () => {
    try {
      const res = await command("TEST_SHEET", { sheet: toSave().sheet });
      setNotice({ severity: "success", text: `Connected to sheet “${res.sheet}” (${res.rows} rows, ${res.headers.length} columns).` });
    } catch (e) {
      setNotice({ severity: "error", text: e.message });
    }
  };

  return (
    <Stack spacing={2}>
      {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert> : null}

      <Typography variant="subtitle2">Search keywords (one per line)</Typography>
      <TextField multiline minRows={5} size="small" value={form.keywordsText} onChange={(e) => set({ keywordsText: e.target.value })} />
      <Typography variant="caption" color="text.secondary">
        Each enabled city is searched once per keyword, as “keyword in City, Pakistan”.
      </Typography>

      <Typography variant="subtitle2">Pace and limits</Typography>
      <Stack direction="row" gap={1}>
        <TextField size="small" type="number" label="Listings per search" value={form.maxPerSearch} onChange={(e) => set({ maxPerSearch: e.target.value })} />
        <TextField size="small" type="number" label="Pause per listing (ms)" value={form.pauseBetweenPlacesMs} onChange={(e) => set({ pauseBetweenPlacesMs: e.target.value })} />
      </Stack>
      <Stack direction="row" gap={1}>
        <TextField size="small" type="number" label="Attempts per search" value={form.maxAttempts} onChange={(e) => set({ maxAttempts: e.target.value })} />
        <TextField size="small" type="number" label="Re-open after (days)" value={form.refreshAfterDays} onChange={(e) => set({ refreshAfterDays: e.target.value })} />
      </Stack>
      <TextField size="small" type="number" label="Treat as stuck after (ms)" value={form.stallTimeoutMs} onChange={(e) => set({ stallTimeoutMs: e.target.value })} />
      <Typography variant="caption" color="text.secondary">
        Searches run one at a time in one Google Maps window. Listings collected within “Re-open after” days are not opened again.
      </Typography>

      <Typography variant="subtitle2">Schedule</Typography>
      <FormControlLabel
        control={<Switch checked={!!form.schedule.enabled} onChange={(e) => set({ schedule: { ...form.schedule, enabled: e.target.checked } })} />}
        label="Run all enabled cities automatically"
      />
      <TextField
        size="small"
        type="number"
        label="Every (hours)"
        value={form.schedule.everyHours}
        disabled={!form.schedule.enabled}
        onChange={(e) => set({ schedule: { ...form.schedule, everyHours: e.target.value } })}
      />
      <Typography variant="caption" color="text.secondary">
        Scheduled runs happen only while Chrome is open, and only for enabled cities.
      </Typography>

      <Typography variant="subtitle2">Owner panel</Typography>
      <TextField size="small" label="Owner panel address" placeholder="https://internet-guru.com/owner" value={form.owner.url} onChange={(e) => setOwner({ url: e.target.value })} />
      <TextField size="small" label="Import key" type="password" value={form.owner.key} onChange={(e) => setOwner({ key: e.target.value })} />
      <Typography variant="caption" color="text.secondary">
        In the owner panel: Prospects → Connect extension. Every ISP saved here is then sent there as a prospect.
        After connecting, use “Send all collected ISPs” on the Dashboard for the ones found before.
      </Typography>
      <Stack direction="row" gap={1}>
        <Button variant="contained" onClick={save}>Save settings</Button>
        <Button onClick={testOwner}>Test owner panel connection</Button>
      </Stack>

      <Typography variant="subtitle2">Google Sheet</Typography>
      <TextField size="small" label="Apps Script web app URL" value={form.sheet.webhookUrl} onChange={(e) => setSheet({ webhookUrl: e.target.value })} />
      <Stack direction="row" gap={1}>
        <TextField size="small" label="Token" type="password" value={form.sheet.token} onChange={(e) => setSheet({ token: e.target.value })} />
        <TextField size="small" label="Sheet (tab) name" value={form.sheet.sheetName} onChange={(e) => setSheet({ sheetName: e.target.value })} />
      </Stack>
      <Stack direction="row" gap={1}>
        <Button variant="contained" onClick={save}>Save settings</Button>
        <Button onClick={test}>Test sheet connection</Button>
      </Stack>
    </Stack>
  );
}
