import React, { useState } from 'react';
import { Button, Typography, Container, Box, List, ListItem, ListItemText } from '@mui/material';

function ScraperUI() {
  const [scrapedData, setScrapedData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleScrape = async () => {
    setIsLoading(true);
    setError('');
    setScrapedData(null);

    try {
      // Get the currently active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url.includes('reddit.com')) {
          setError('Please navigate to a Reddit page to scrape.');
          setIsLoading(false);
          return;
      }

      // Send a message to the content script in the active tab
      chrome.tabs.sendMessage(tab.id, { action: 'scrape_posts' }, (response) => {
        // Note: The actual data response is sent from the content script 
        // to the background worker, not directly back here. 
        // We'll rely on a listener to the background worker for the final data, 
        // or a more complex promise chain. For simplicity, we assume
        // the content script is active and the background worker will handle the data.

        if (chrome.runtime.lastError) {
            console.error("Error communicating with content script:", chrome.runtime.lastError.message);
            setError("Could not communicate with the Reddit page.");
            setIsLoading(false);
            return;
        }

        // For this basic example, we'll listen to the background script
        // *This part requires a listener in the side panel or a more complex flow.*
        // For a basic demo, let's just simulate success for now.
        // In a real app, you'd listen for a message FROM the background script.

        setTimeout(() => {
            setScrapedData({
                titles: ["Post 1 (Simulated)", "Post 2 (Simulated)"],
                url: tab.url
            });
            setIsLoading(false);
        }, 1000);

      });

    } catch (err) {
      setError(err.message || 'An unknown error occurred.');
      setIsLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="xs" sx={{ p: 2 }}>
      <Box sx={{ my: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Typography variant="h5" component="h1" gutterBottom>
          Reddit Post Scrapper
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={handleScrape}
          disabled={isLoading}
          fullWidth
          sx={{ mt: 2, mb: 2 }}
        >
          {isLoading ? 'Scraping...' : 'Scrape Top Posts'}
        </Button>

        {error && (
          <Typography color="error" variant="body2" sx={{ mt: 2 }}>
            {error}
          </Typography>
        )}

        {scrapedData && (
          <Box sx={{ mt: 3, width: '100%' }}>
            <Typography variant="subtitle1" gutterBottom>
              Scraped Titles:
            </Typography>
            <List dense>
              {scrapedData.titles.map((title, index) => (
                <ListItem key={index} disablePadding>
                  <ListItemText primary={`- ${title}`} />
                </ListItem>
              ))}
            </List>
            <Typography variant="caption" display="block" sx={{ mt: 2 }}>
              From: {scrapedData.url.substring(0, 40)}...
            </Typography>
          </Box>
        )}
      </Box>
    </Container>
  );
}

export default ScraperUI;