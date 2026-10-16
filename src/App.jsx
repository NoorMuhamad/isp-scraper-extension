import { useState } from "react";
import { Alert, Box, CircularProgress, CssBaseline, Snackbar, Tab, Tabs } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { useStore } from "./components/useStore";
import Dashboard from "./components/Dashboard";
import Cities from "./components/Cities";
import Settings from "./components/Settings";

const theme = createTheme({
  palette: { mode: "light", primary: { main: "#1D4ED8" } },
  typography: { fontSize: 12, button: { textTransform: "none" } },
});

export default function App() {
  const state = useStore();
  const [tab, setTab] = useState(0);
  const [error, setError] = useState("");

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Dashboard" />
        <Tab label="Cities" />
        <Tab label="Settings" />
      </Tabs>
      <Box sx={{ p: 1.5 }}>
        {!state?.cities ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}><CircularProgress size={24} /></Box>
        ) : tab === 0 ? (
          <Dashboard state={state} onError={setError} />
        ) : tab === 1 ? (
          <Cities state={state} onError={setError} />
        ) : (
          <Settings settings={state.settings} onError={setError} />
        )}
      </Box>
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError("")}>
        <Alert severity="error" onClose={() => setError("")} sx={{ width: "100%" }}>{error}</Alert>
      </Snackbar>
    </ThemeProvider>
  );
}
