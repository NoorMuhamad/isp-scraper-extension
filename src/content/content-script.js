let isRunning = false;
let maxResults = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrape(maxCount) {
  isRunning = true;
  maxResults = maxCount;
  const feed = document.querySelector('div[role="feed"]');
  if (!feed) {
    chrome.runtime.sendMessage({ action: 'SCRAPE_ERROR', error: 'Could not find the results feed. Are you on a Google Maps search results page?' });
    return;
  }

  let prevItems = -1;
  let sameCount = 0;
  let scrapedUrls = new Set();
  
  while (isRunning) {
    let currentCards = Array.from(document.querySelectorAll('div[role="article"]'));
    
    // Scrape whatever is visible and new
    for (let i = 0; i < currentCards.length; i++) {
      if (!isRunning) break;
      if (scrapedUrls.size >= maxResults) break;

      // Re-fetch card by index to avoid Detached DOM Node errors when returning from details view
      let refreshedCards = Array.from(document.querySelectorAll('div[role="article"]'));
      if (i >= refreshedCards.length) break;
      let card = refreshedCards[i];

      const mapsLinkEl = card.querySelector('a.hfpxzc');
      if (!mapsLinkEl) continue;
      const mapsLink = mapsLinkEl.getAttribute('href');
      
      if (scrapedUrls.has(mapsLink)) continue;
      
      const nameEl = card.querySelector('.qBF1Pd');
      if (!nameEl) continue;
      
      const name = nameEl.textContent || '';
      const rating = card.querySelector('.MW4etd')?.textContent || '';
      const reviews = card.querySelector('.UY7F9')?.textContent || '';
      const phone = card.querySelector('.UsdlK')?.textContent || '';
      const website = card.querySelector('a[data-value="Website"]')?.getAttribute('href') || '';
      
      // Navigate to Place Details to get Plus Code
      mapsLinkEl.click();
      await sleep(2500); // Wait for detail panel to render

      let plusCode = '';
      const plusCodeBtn = document.querySelector('button[aria-label*="Plus code:"]');
      if (plusCodeBtn) {
         plusCode = plusCodeBtn.getAttribute('aria-label') || '';
         plusCode = plusCode.replace(/^Plus code:\s*/i, '').trim();
      }

      // Click "Back" to return to search feed
      const backBtn = document.querySelector('button[aria-label="Back"]') || document.querySelector('button[jsaction*="back"]');
      if (backBtn) {
         backBtn.click();
         await sleep(2000); // Wait for search feed to slide back in
      }
      
      scrapedUrls.add(mapsLink);
      
      chrome.runtime.sendMessage({
        action: 'SCRAPE_RESULT',
        data: { name, rating, reviews, phone, website, plusCode, mapsLink }
      });
    }

    if (scrapedUrls.size >= maxResults) {
      chrome.runtime.sendMessage({ action: 'SCRAPE_FINISHED', reason: 'MAX_REACHED' });
      break;
    }

    if (currentCards.length === prevItems) {
      sameCount++;
    } else {
      sameCount = 0;
    }

    if (sameCount >= 10) {
      chrome.runtime.sendMessage({ action: 'SCRAPE_FINISHED', reason: 'END_OF_LIST' });
      break;
    }

    prevItems = currentCards.length;

    // Google Maps rebuilds the feed when navigating back from card details!
    // We MUST re-fetch the container element explicitly otherwise scrollBy targets a detached, hidden DOM node.
    const activeFeed = document.querySelector('div[role="feed"]');
    if (activeFeed) {
      activeFeed.scrollBy(0, 1500);
    }
    await sleep(1500);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_SCRAPE') {
    if (isRunning) {
      sendResponse({ status: 'Already running' });
      return;
    }
    scrape(request.max || 50);
    sendResponse({ status: 'Started' });
  } else if (request.action === 'STOP_SCRAPE') {
    isRunning = false;
    sendResponse({ status: 'Stopped' });
  }
  // Optional true return for async sendResponse if needed later
});