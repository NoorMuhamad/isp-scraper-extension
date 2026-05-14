import React, { useState, useEffect, useRef } from 'react';
import { Button, TextField, Typography, Container, Box, List, ListItem, ListItemText, Paper, CircularProgress } from '@mui/material';

// CSV Escape helper
const esc = v => `"${String(v || '').replace(/"/g, '""')}"`;

function ScraperUI() {
  const [query, setQuery] = useState('');
  const [maxResults, setMaxResults] = useState(50);
  
  const [fileName, setFileName] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  
  const fileHandleRef = useRef(null);
  const duplicatesRef = useRef(new Set());
  const lastIndexRef = useRef(0);
  const writeQueueRef = useRef(Promise.resolve());

  const handleSelectFile = async () => {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'CSV Files',
          accept: { 'text/csv': ['.csv'] },
        }],
        multiple: false
      });
      fileHandleRef.current = handle;
      setFileName(handle.name);
      
      const file = await handle.getFile();
      const text = await file.text();
      
      const lines = text.split('\n').filter(Boolean);
      const newSet = new Set();
      let maxNo = 0;
      
      // Parse expecting: no,name,rating,reviews,phone,website,maps_link
      for (const line of lines.slice(1)) {
        const matchLink = line.match(/"([^"]+)"\s*$/);
        if (matchLink && matchLink[1]) {
           newSet.add(matchLink[1]);
        }
        
        const firstComma = line.indexOf(',');
        if (firstComma > 0) {
           const idStr = line.substring(0, firstComma);
           const id = parseInt(idStr, 10);
           if (!isNaN(id) && id > maxNo) maxNo = id;
        }
      }
      duplicatesRef.current = newSet;
      lastIndexRef.current = maxNo;
      setResults([]);
      setSavedCount(0);
    } catch (e) {
      console.log('File selection cancelled or failed', e);
    }
  };

  const saveRowToFile = (rowString) => {
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      try {
        if (!fileHandleRef.current) return;
        
        const file = await fileHandleRef.current.getFile();
        const writable = await fileHandleRef.current.createWritable({ keepExistingData: true });
        
        let prefix = '';
        if (file.size === 0) {
          prefix = 'no,name,rating,reviews,phone,website,plus_code,maps_link\n';
        }
        
        await writable.seek(file.size);
        await writable.write(prefix + rowString + '\n');
        await writable.close();
      } catch(e) {
        console.error('Failed to append to file', e);
      }
    });
  };

  useEffect(() => {
    const handleMessage = async (request, sender, sendResponse) => {
      if (request.action === 'SCRAPE_RESULT') {
        const data = request.data;
        if (duplicatesRef.current.has(data.mapsLink)) return;
        
        duplicatesRef.current.add(data.mapsLink);
        lastIndexRef.current += 1;
        
        const no = lastIndexRef.current;
        const rowString = [
          no,
          esc(data.name.trim()),
          esc(data.rating.trim()),
          esc(data.reviews.trim()),
          esc(data.phone.trim()),
          esc(data.website.trim()),
          esc(data.plusCode ? data.plusCode.trim() : ''),
          esc(data.mapsLink.trim())
        ].join(',');

        if (fileHandleRef.current) {
          await saveRowToFile(rowString);
        }
        
        setSavedCount(prev => prev + 1);
        setResults(prev => [data, ...prev]);
        
      } else if (request.action === 'SCRAPE_FINISHED') {
        setIsLoading(false);
      } else if (request.action === 'SCRAPE_ERROR') {
        setError(request.error);
        setIsLoading(false);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleStartScrape = () => {
    if (!query) {
      setError('Please enter a query');
      return;
    }
    
    if (!fileHandleRef.current) {
      setError('Please select a CSV file first');
      return;
    }

    setError('');
    setIsLoading(true);

    const targetUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    
    chrome.tabs.create({ url: targetUrl, active: true }, (tab) => {
      const tabId = tab.id;
      
      const listener = (changedTabId, changeInfo, tabInfo) => {
        if (changedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          // Small delay to ensure content script injects
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: 'START_SCRAPE', max: parseInt(maxResults, 10) });
          }, 2000);
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
    });
  };

  const handleStopScrape = () => {
    chrome.tabs.query({ url: "*://*.google.com/maps/*" }, (tabs) => {
       tabs.forEach(tab => {
         chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPE' });
       });
    });
    setIsLoading(false);
  };

  return (
    <Container component="main" maxWidth="sm" sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom fontWeight="bold">
        Google Maps Scraper
      </Typography>
      
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
        <Button 
          variant={fileName ? "outlined" : "contained"} 
          color="secondary" 
          onClick={handleSelectFile}
          fullWidth
        >
          {fileName ? `File: ${fileName}` : 'Select/Create CSV File'}
        </Button>
        {fileName && (
          <Typography variant="caption" align="center">
            Found {duplicatesRef.current.size} existing rows. Next ID: {lastIndexRef.current + 1}
          </Typography>
        )}

        <TextField 
          label="Search Query" 
          variant="outlined" 
          size="small"
          value={query} 
          onChange={(e) => setQuery(e.target.value)} 
          disabled={isLoading}
        />
        
        <TextField 
          label="Max Results" 
          type="number" 
          variant="outlined" 
          size="small"
          value={maxResults} 
          onChange={(e) => setMaxResults(e.target.value)} 
          disabled={isLoading}
        />

        {!isLoading ? (
          <Button variant="contained" color="primary" onClick={handleStartScrape}>
            Start Scrape
          </Button>
        ) : (
          <Button variant="contained" color="error" onClick={handleStopScrape}>
            Stop Scrape
          </Button>
        )}
      </Box>

      {error && (
        <Typography color="error" variant="body2" sx={{ mb: 2, fontWeight: 'bold' }}>
          {error}
        </Typography>
      )}

      {isLoading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
          <CircularProgress size={24} sx={{ mr: 2 }} />
          <Typography>Scraping in progress...</Typography>
        </Box>
      )}

      <Typography variant="subtitle1" fontWeight="bold">
        Session Saved: {savedCount}
      </Typography>

      <Paper variant="outlined" sx={{ maxHeight: 300, overflow: 'auto', mt: 1 }}>
        <List dense>
          {results.map((r, i) => (
            <ListItem divider key={i}>
              <ListItemText 
                primary={r.name} 
                secondary={`${r.phone} | ${r.rating} stars`} 
              />
            </ListItem>
          ))}
          {results.length === 0 && (
            <ListItem>
              <ListItemText secondary="No new results yet" />
            </ListItem>
          )}
        </List>
      </Paper>
    </Container>
  );
}

export default ScraperUI;