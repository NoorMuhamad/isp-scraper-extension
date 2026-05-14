// Set up the side panel behavior to open on action click
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
});

// A simple listener for messages from the content script or side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrape_complete') {
    console.log('Scraping successful! Data:', message.data);
    sendResponse({ status: 'Data received by background worker' });
    return true; // Keep the message channel open for sendResponse
  }
});