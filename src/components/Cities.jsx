import { useMemo, useState } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Chip, IconButton, MenuItem, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import { command, formatWhen } from "./useStore";

const STATUS = {
  queued: ["Queued", "info"],
  running: ["Running", "primary"],
  paused: ["Paused", "warning"],
  done: ["Done", "success"],
  failed: ["Failed", "error"],
  stopped: ["Stopped", "default"],
  disabled: ["Disabled", "default"],
};

export default function Cities({ state, onError }) {
  const { cities = {}, cityStats = {}, run = {} } = state;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = {};
    for (const [id, c] of Object.entries(cities)) {
      const s = cityStats[id] || {};
      if (q && !c.name.toLowerCase().includes(q) && !c.province.toLowerCase().includes(q)) continue;
      if (filter === "enabled" && !c.enabled) continue;
      if (filter === "disabled" && c.enabled) continue;
      if (filter === "active" && !["queued", "running", "paused"].includes(s.status)) continue;
      if (filter === "failed" && !s.failedKeywords?.length) continue;
      (out[c.province] ||= []).push({ id, ...c, stats: s });
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [cities, cityStats, search, filter]);

  const run_ = (fn) => fn().catch((e) => onError(e.message));
  const setEnabled = (ids, enabled) => run_(() => command("SET_CITIES_ENABLED", { ids, enabled }));
  const queuedCities = new Set((run.queue || []).map((t) => t.cityId));

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" gap={1}>
        <TextField size="small" placeholder="Search city or province" value={search} onChange={(e) => setSearch(e.target.value)} fullWidth />
        <TextField size="small" select value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 110 }}>
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="enabled">Enabled</MenuItem>
          <MenuItem value="disabled">Disabled</MenuItem>
          <MenuItem value="active">In progress</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
        </TextField>
      </Stack>

      {Object.entries(groups).map(([province, list]) => {
        const all = Object.entries(cities).filter(([, c]) => c.province === province);
        const on = all.filter(([, c]) => c.enabled).length;
        return (
          <Accordion key={province} disableGutters defaultExpanded={!!search || filter !== "all"}>
            <AccordionSummary expandIcon={<span>▾</span>}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: "100%", pr: 1 }}>
                <Typography variant="subtitle2">
                  {province}{" "}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {on}/{all.length} on
                  </Typography>
                </Typography>
                <Tooltip title={on === all.length ? "Switch every city in this province off" : "Switch every city in this province on"}>
                  <Switch
                    size="small"
                    checked={on === all.length}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEnabled(all.map(([id]) => id), e.target.checked)}
                  />
                </Tooltip>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              {list.map((c) => {
                const s = c.stats;
                const [label, color] = STATUS[s.status] || ["Not run", "default"];
                const inRun = queuedCities.has(c.id);
                return (
                  <Box key={c.id} sx={{ px: 2, py: 1, borderTop: 1, borderColor: "divider" }}>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Switch size="small" checked={c.enabled} onChange={(e) => setEnabled([c.id], e.target.checked)} />
                      <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>{c.name}</Typography>
                      <Chip size="small" label={label} color={color} variant={color === "default" ? "outlined" : "filled"} />
                      {inRun ? (
                        <Tooltip title="Stop this city">
                          <IconButton size="small" onClick={() => run_(() => command("STOP_CITY", { cityId: c.id }))}>■</IconButton>
                        </Tooltip>
                      ) : (
                        <Tooltip title={c.enabled ? "Start this city now" : "Enable the city to scrape it"}>
                          <span>
                            <IconButton size="small" disabled={!c.enabled} onClick={() => run_(() => command("START", { cityIds: [c.id] }))}>▶</IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ pl: 5 }}>
                      {s.found || 0} ISPs found · {s.newLastRun || 0} new last run
                      {s.totalTasks && ["queued", "running", "paused"].includes(s.status) ? ` · ${s.doneTasks || 0}/${s.totalTasks} searches` : ""}
                      {" · "}last run {formatWhen(s.lastRunAt)}
                    </Typography>
                    {s.lastError ? (
                      <Typography variant="caption" color="error" component="div" sx={{ pl: 5 }}>
                        {s.lastError}
                        {s.failedKeywords?.length ? ` (failed: ${s.failedKeywords.join(", ")})` : ""}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </AccordionDetails>
          </Accordion>
        );
      })}
      {!Object.keys(groups).length ? <Typography variant="body2" color="text.secondary">No city matches.</Typography> : null}
    </Stack>
  );
}
