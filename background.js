// background.js

// A mapping of tabId to domain counts
const tabDomainCounts = {};

// Listen to all network requests
chrome.webRequest.onCompleted.addListener(
    (details) => {
      // Only handle requests that belong to a tab (ignore extension/background requests)
      if (details.tabId >= 0) {
        let url;
        try {
          url = new URL(details.url);
        } catch (e) {
          return;
        }
        const domain = getTopLevelDomain(url.hostname);
        if (!tabDomainCounts[details.tabId]) {
          tabDomainCounts[details.tabId] = {};
        }
        if (!tabDomainCounts[details.tabId][domain]) {
          tabDomainCounts[details.tabId][domain] =  {
            count: 0,
            bytes: 0,
            formatedBytes: "0 B"
          };
        }
        tabDomainCounts[details.tabId][domain].count++;

        let responseSize = 0;
        if (details.responseHeaders) {
          const contentLengthHeader = details.responseHeaders.find(
            header => header.name.toLowerCase() === 'content-length'
          );
          if (contentLengthHeader) {
            responseSize = parseInt(contentLengthHeader.value, 10) || 0;
          }
        }
        tabDomainCounts[details.tabId][domain].bytes += responseSize;
        tabDomainCounts[details.tabId][domain].formatedBytes = formatBytes(tabDomainCounts[details.tabId][domain].bytes);
  
        // Send the updated counts to the content script of the tab.
        chrome.tabs.sendMessage(details.tabId, {
          type: "updateDomainCounts",
          counts: tabDomainCounts[details.tabId]
        });
      }
    },
    { urls: ["<all_urls>"] }, ["responseHeaders"] 
);
  
  // A simple heuristic to extract the top-level domain (e.g., "example.com" from "sub.example.com")
function getTopLevelDomain(hostname) {
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return hostname;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "getData",
    title: "Get Data",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "getData") {
    // First check if we can send messages to this tab
    chrome.tabs.get(tab.id, (tabInfo) => {
      if (!tabInfo.url.startsWith('chrome://') && !tabInfo.url.startsWith('chrome-extension://')) {
        // Add error handling to prevent uncaught errors
        chrome.tabs.sendMessage(tab.id, { action: "activateGetData" })
          .catch(error => {
            console.error("Error sending message to content script:", error);
            // Optionally show an alert to the user
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => alert("Content script not ready. Please refresh the page and try again.")
            }).catch(err => console.error("Could not show alert:", err));
          });
      } else {
        console.warn("Cannot execute content scripts in this tab type");
      }
    });
  }
});
