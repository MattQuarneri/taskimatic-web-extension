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
  // Shows the DOM breadcrumbs from body to get to this element. Clicking the breadcrumbs puts an outline around the element.
  chrome.contextMenus.create({
    id: "getPath",
    title: "Get Path",
    contexts: ["all"]
  });

  // Main "Get Data" action
  chrome.contextMenus.create({
    id: "getData",
    title: "Get Data",
    contexts: ["all"]
  });
  
  // Parent menu for format selection
  chrome.contextMenus.create({
    id: "getDataFormat",
    title: "Get Data Format",
    contexts: ["all"]
  });
  
  // Format options
  chrome.contextMenus.create({
    id: "format-tsv",
    parentId: "getDataFormat",
    title: "TSV (Spreadsheet)",
    contexts: ["all"]
  });
  chrome.contextMenus.create({
    id: "format-csv",
    parentId: "getDataFormat",
    title: "CSV",
    contexts: ["all"]
  });
  chrome.contextMenus.create({
    id: "format-markdown",
    parentId: "getDataFormat",
    title: "Markdown Table",
    contexts: ["all"]
  });
  chrome.contextMenus.create({
    id: "format-json",
    parentId: "getDataFormat",
    title: "JSON",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Handle format selection
  if (info.menuItemId.startsWith("format-")) {
    const format = info.menuItemId.replace("format-", "");
    chrome.tabs.get(tab.id, (tabInfo) => {
      if (!tabInfo.url.startsWith('chrome://') && !tabInfo.url.startsWith('chrome-extension://')) {
        chrome.tabs.sendMessage(tab.id, { action: "setOutputFormat", format })
          .catch(error => console.error("Error setting format:", error));
      }
    });
    return;
  }

  if (info.menuItemId === "getPath") {
    chrome.tabs.get(tab.id, (tabInfo) => {
      if (!tabInfo.url.startsWith('chrome://') && !tabInfo.url.startsWith('chrome-extension://')) {
        const frameId = Number.isInteger(info.frameId) ? info.frameId : 0;
        chrome.tabs.sendMessage(
          tab.id,
          { action: "activateGetPath" },
          { frameId }
        ).then(response => {
          if (!response || !response.ok) {
            showGetPathUnavailable(tab.id, response && response.error);
          }
        }).catch(error => {
          console.error("Error showing DOM path:", error);
          showGetPathUnavailable(tab.id);
        });
      } else {
        console.warn("Cannot execute content scripts in this tab type");
      }
    });
    return;
  }
  
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

function showGetPathUnavailable(tabId, errorMessage) {
  const message = errorMessage ||
    "Get Path is not ready on this page. Refresh the page and try again.";

  chrome.scripting.executeScript({
    target: { tabId },
    func: messageToShow => alert(messageToShow),
    args: [message]
  }).catch(error => console.error("Could not show Get Path error:", error));
}

// A dedicated extension window keeps collected JSON visible while the user
// navigates between Target's list and individual purchase pages.
const TARGET_DATA_KEY = "targetCapturedData";
let targetDataWriteQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.action === "openTargetDataWindow" && sender.id === chrome.runtime.id) {
    openTargetDataWindow().then(() => respond({ ok: true }))
      .catch(error => respond({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.action !== "appendTargetData") return;
  const source = sender.url || sender.tab?.url || "";
  let path;
  try {
    const url = new URL(source);
    if (url.origin !== "https://www.target.com") throw new Error("Not a Target page.");
    path = url.pathname;
  } catch {
    respond({ ok: false, error: "Target data can only be captured from Target pages." });
    return;
  }

  const isList = message.pageType === "orders" && /^\/orders\/?$/.test(path);
  const detailId = /^\/orders\/stores\/([0-9-]+)\/?$/.exec(path)?.[1];
  const isDetail = message.pageType === "purchase" && detailId && message.data?.id === detailId;
  if (!isList && !isDetail) {
    respond({ ok: false, error: "This page does not match the captured Target data." });
    return;
  }

  targetDataWriteQueue = targetDataWriteQueue.catch(() => {}).then(async () => {
    const { processTargetData } = await chrome.storage.local.get({ processTargetData: false });
    if (!processTargetData) throw new Error("Turn on Process Target data in the Content tab.");

    const previous = (await chrome.storage.local.get(TARGET_DATA_KEY))[TARGET_DATA_KEY] || {};
    const state = {
      orders: { ...(previous.orders || {}) },
      purchases: { ...(previous.purchases || {}) },
      updatedAt: new Date().toISOString()
    };
    if (isList) {
      if (!Array.isArray(message.data?.orders)) throw new Error("No order list was found.");
      for (const order of message.data.orders) {
        if (order?.id && /^\d+(?:-\d+)+$/.test(order.id)) {
          state.orders[order.id] = order;
        }
      }
    } else {
      state.purchases[detailId] = message.data;
    }
    await chrome.storage.local.set({ [TARGET_DATA_KEY]: state });
    await openTargetDataWindow();
    return {
      ok: true,
      orderCount: Object.keys(state.orders).length,
      purchaseCount: Object.keys(state.purchases).length
    };
  });

  targetDataWriteQueue.then(respond).catch(error => {
    respond({ ok: false, error: error.message || String(error) });
  });
  return true;
});

async function openTargetDataWindow() {
  const url = chrome.runtime.getURL("target-data.html");
  const windows = await chrome.windows.getAll({ populate: true });
  const existing = windows.find(window => window.tabs?.some(tab => tab.url === url));
  if (existing) {
    await chrome.windows.update(existing.id, { focused: true, state: "normal" });
  } else {
    await chrome.windows.create({ url, type: "popup", width: 760, height: 680 });
  }
}
