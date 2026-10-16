import { useState } from "react";
import { Alert, Box, Button, Card, CardContent, LinearProgress, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import { command, formatWhen } from "./useStore";
import { toCsv } from "../shared/records";

function Stat({ label, value }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 0 }}>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

async function exportCsv() {
  const all = await chrome.storage.local.get(null);
  const records = Object.entries(all).filter(([k]) => k.startsWith("rec:")).map(([, v]) => v);
  records.sort((a, b) => (a.province + a.city + a.name).localeCompare(b.province + b.city + b.name));
  const blob = new Blob([toCsv(records)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pakistan-isps-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function Dashboard({ state, onError }) {
  const [busy, setBusy] = useState(false);
  const { cities = {}, cityStats = {}, run = {}, sync = {}, errors = [], recordCount = 0, settings = {} } = state;
  const all = Object.values(cities);
  const enabled = all.filter((c) => c.enabled).length;
  const failedCities = Object.values(cityStats).filter((s) => s.failedKeywords?.length).length;
  const progress = run.totalTasks ? Math.round((run.doneTasks / run.totalTasks) * 100) : 0;

  const act = (type, payload) => async () => {
    setBusy(true);
    try {
      await command(type, payload);
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      {/* Three per row: fits the side panel's narrow default width. */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
        <Stat label="Cities" value={all.length} />
        <Stat label="Enabled" value={enabled} />
        <Stat label="Disabled" value={all.length - enabled} />
        <Stat label="Unique ISPs" value={recordCount} />
        <Stat label="New this run" value={run.newThisRun || 0} />
        <Stat label="Failed cities" value={failedCities} />
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Run: {run.status === "running" ? "Running" : run.status === "paused" ? "Paused" : "Idle"}
            {run.mode === "schedule" && run.status !== "idle" ? " (scheduled)" : ""}
          </Typography>
          {run.blocked ? (
            <Alert severity="warning" sx={{ mb: 1 }}>
              Google asked to confirm you are not a robot. Complete it yourself in the Google Maps window, then Resume.
            </Alert>
          ) : null}
          {run.current ? (
            <Typography variant="body2" color="text.secondary">
              {run.current.cityName}: “{run.current.keyword}” · {run.current.saved || 0} listings saved
            </Typography>
          ) : null}
          {run.status !== "idle" ? (
            <Box sx={{ my: 1 }}>
              <LinearProgress variant="determinate" value={progress} />
              <Typography variant="caption" color="text.secondary">
                {run.doneTasks} of {run.totalTasks} searches · {run.queue?.length || 0} left
              </Typography>
            </Box>
          ) : null}
          <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
            {run.status === "idle" ? (
              <Button variant="contained" disabled={busy || !enabled} onClick={act("START")}>
                Start enabled cities ({enabled})
              </Button>
            ) : null}
            {run.status === "running" ? <Button variant="outlined" disabled={busy} onClick={act("PAUSE")}>Pause</Button> : null}
            {run.status === "paused" ? <Button variant="contained" disabled={busy} onClick={act("RESUME")}>Resume</Button> : null}
            {run.status !== "idle" ? <Button color="error" disabled={busy} onClick={act("STOP")}>Stop</Button> : null}
            {failedCities ? <Button disabled={busy} onClick={act("RETRY_FAILED")}>Retry failed</Button> : null}
          </Stack>
          {!enabled ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              No city is enabled. Switch cities on in the Cities tab; only enabled cities are ever scraped.
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Last successful run: {formatWhen(run.lastSuccessfulRunAt)}
            {settings.schedule?.enabled ? ` · scheduled every ${settings.schedule.everyHours} h` : ""}
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>Google Sheet</Typography>
          {settings.sheet?.webhookUrl ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {sync.pending?.length || 0} waiting · {sync.added || 0} rows added · {sync.updated || 0} updated · last sync{" "}
                {formatWhen(sync.lastSyncAt)}
              </Typography>
              {sync.lastError ? (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {sync.lastError}
                  {sync.nextAttemptAt ? ` Retrying after ${new Date(sync.nextAttemptAt).toLocaleTimeString()}.` : ""}
                </Alert>
              ) : null}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">Not connected. Set it up in Settings.</Typography>
          )}
          <Stack direction="row" gap={1} sx={{ mt: 1 }}>
            <Button size="small" disabled={busy || !settings.sheet?.webhookUrl || !sync.pending?.length} onClick={act("SYNC_NOW")}>
              Sync now
            </Button>
            <Button size="small" disabled={!recordCount} onClick={exportCsv}>Download CSV</Button>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent sx={{ pb: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2">Errors</Typography>
            {errors.length ? <Button size="small" onClick={act("CLEAR_ERRORS")}>Clear</Button> : null}
          </Stack>
          {errors.length ? (
            <List dense sx={{ maxHeight: 220, overflow: "auto" }}>
              {errors.slice(0, 30).map((e, i) => (
                <ListItem key={i} disableGutters>
                  <ListItemText
                    primary={e.message}
                    secondary={`${formatWhen(e.at)}${e.cityId ? ` · ${cities[e.cityId]?.name || e.cityId}` : ""}${e.keyword ? ` · ${e.keyword}` : ""}`}
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">None.</Typography>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
