import React from 'react';
import ScraperUI from './components/ScraperUI';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// Basic MUI Theme
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#FF4500', // Reddit Orange
    },
  },
  typography: {
    fontSize: 12,
    button: {
        textTransform: 'none',
    }
  }
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline /> 
      <ScraperUI />
    </ThemeProvider>
  );
}

export default App;