if (!customElements.get('tab-widget')) {
  console.error('tab-widget component not loaded or registered');
}

// When the DOM is loaded, load tabs and bookmarks.
document.addEventListener('DOMContentLoaded', function() {
    // Retrieve and display open tab URLs.
    let tabCount = 0;
    chrome.tabs.query({}, function(tabs) {
      const tabsList = document.getElementById('tabsList');
      tabs.forEach(tab => {
        tabCount++;
        tabsList.appendChild(renderTab(tab));
      });
      document.getElementById("save2JSON").textContent = `Save ${tabCount} Tabs to JSON`;
    });
    
    // Retrieve and display bookmark tree.
    chrome.bookmarks.getTree(function(bookmarkTreeNodes) {
      const container = document.getElementById('bookmarksContainer');
      container.innerHTML = "";
      bookmarkTreeNodes.forEach(node => {
        container.appendChild(createBookmarkElement(node));
      });
    });
    
    // Reorganize bookmarks on button click.
    document.getElementById('reorganizeBtn').addEventListener('click', function() {
      if (confirm("This will reorganize your bookmarks by sorting them alphabetically. Proceed?")) {
        reorganizeBookmarks();
      }
    });
    
    // Load history timeline on button click.
    document.getElementById('loadHistoryBtn').addEventListener('click', function() {
      loadHistory();
    });
    // Save open tab URLs and titles to JSON file on button click.
    document.getElementById('save2JSON').addEventListener('click', function() {
      chrome.tabs.query({}, function(tabs) {
        const tabData = tabs.map(tab => ({ url: tab.url, title: tab.title }));
        const json = JSON.stringify(tabData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const d = new Date();
        const ts = d.getFullYear() +
          String(d.getMonth()+1).padStart(2,'0') +
          String(d.getDate()).padStart(2,'0') +
          String(d.getHours()).padStart(2,'0') +
          String(d.getMinutes()).padStart(2,'0') +
          String(d.getSeconds()).padStart(2,'0');

        a.download = `open-tabs-${ts}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      });
    });
  });
  
  // --- Tabs Functions ---
  
  // Helper to convert a URL to a readable name
  function URLtoName(url) {
    try {
      // Remove protocol
      url = url.replace(/^https?:\/\//, '');
      // Remove www.
      url = url.replace(/^www\./, '');
      // Remove .com (and optionally .net, .org, etc. for more generality)
      url = url.replace(/\.(com|net|org|io|co|gov|edu)(\/|$)/, '/');
      // Remove URL arguments
      url = url.split('?')[0];
      // Replace / and - with spaces
      url = url.replace(/[\/-]+/g, ' ');
      // Remove trailing slash
      url = url.replace(/\/$/, '');
      // Trim whitespace
      url = url.trim();
      return url;
    } catch (e) {
      return url;
    }
  }

  // Render a tab as an LI with a button linking to the tab's URL and a readable name
  function renderTab(tab) {
    let li = document.createElement('li');
    let button = document.createElement('button');
    let a = document.createElement('a');
    a.href = tab.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = URLtoName(tab.url);
    button.appendChild(a);
    li.appendChild(button);
    return li;
  }
  
  // --- Bookmarks Functions ---
  
  // Recursively create HTML elements for bookmark nodes.
  function createBookmarkElement(node) {
    let container = document.createElement('div');
    let title = document.createElement('span');
    
    // Folders do not have URLs.
    if (node.url) {
      title.textContent = node.title || node.url;
    } else {
      title.textContent = node.title || "Folder";
      title.className = "folder";
    }
    
    container.appendChild(title);
    
    if (node.children && node.children.length > 0) {
      let list = document.createElement('ul');
      node.children.forEach(child => {
        let listItem = document.createElement('li');
        listItem.appendChild(createBookmarkElement(child));
        list.appendChild(listItem);
      });
      container.appendChild(list);
    }
    return container;
  }
  
  // Recursively sort folder children alphabetically.
  function sortFolderRecursively(node) {
    if (!node.children || node.children.length === 0) {
      return;
    }
    
    // Sort children by title (folders and bookmarks alike).
    let sortedChildren = node.children.slice().sort((a, b) => {
      let titleA = a.title.toLowerCase();
      let titleB = b.title.toLowerCase();
      return titleA.localeCompare(titleB);
    });
    
    sortedChildren.forEach((child, index) => {
      if (child.index !== index) {
        chrome.bookmarks.move(child.id, { parentId: node.id, index: index });
      }
      if (child.children) {
        sortFolderRecursively(child);
      }
    });
  }
  
  // Reorganize bookmarks: sort all folders.
  function reorganizeBookmarks() {
    chrome.bookmarks.getTree(function(bookmarkTreeNodes) {
      bookmarkTreeNodes.forEach(rootNode => {
        sortFolderRecursively(rootNode);
      });
      // Refresh bookmark display.
      chrome.bookmarks.getTree(function(updatedTree) {
        const container = document.getElementById('bookmarksContainer');
        container.innerHTML = "";
        updatedTree.forEach(node => {
          container.appendChild(createBookmarkElement(node));
        });
      });
    });
  }
  
  // --- History Functions ---
  
  // Load and process browsing history.
  function loadHistory() {
    // Define a time window (e.g., the past 30 days).
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    chrome.history.search({text: '', startTime: oneMonthAgo, maxResults: 1000}, function(historyItems) {
      // Sort history items in ascending order by lastVisitTime.
      historyItems.sort((a, b) => a.lastVisitTime - b.lastVisitTime);
      // Deduplicate history entries (using a 10-minute threshold).
      const dedupedHistory = dedupeHistory(historyItems, 10 * 60 * 1000);
      displayHistory(dedupedHistory);
    });
  }
  
  // Remove consecutive history items for the same site if they occur within a threshold.
  function dedupeHistory(items, thresholdMs) {
    if (items.length === 0) return [];
    let deduped = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const current = items[i];
      const last = deduped[deduped.length - 1];
      try {
        const currentHost = new URL(current.url).host;
        const lastHost = new URL(last.url).host;
        if (currentHost === lastHost && (current.lastVisitTime - last.lastVisitTime < thresholdMs)) {
          // Skip current item as it's considered a duplicate within the threshold.
          continue;
        } else {
          deduped.push(current);
        }
      } catch(e) {
        // If URL parsing fails, add the entry.
        deduped.push(current);
      }
    }
    return deduped;
  }
  
  // Display the history items in a list.
  function displayHistory(items) {
    const container = document.getElementById('historyContainer');
    container.innerHTML = "";
    let ul = document.createElement('ul');
    items.forEach(item => {
      let li = document.createElement('li');
      let date = new Date(item.lastVisitTime).toLocaleString();
      li.textContent = `${date}: ${item.url}`;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  // --- Cookie Functions ---
  // Populate the autocomplete list with unique domains from all cookies.
  function populateDomains() {
    chrome.cookies.getAll({}, function(cookies) {
      const domainsSet = new Set();
      cookies.forEach(cookie => {
        // Remove leading dot if present.
        let domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        domainsSet.add(domain);
      });
      const datalist = document.getElementById('domainsList');
      datalist.innerHTML = "";
      domainsSet.forEach(domain => {
        const option = document.createElement('option');
        option.value = domain;
        datalist.appendChild(option);
      });
    });
  }
  
  // Clear cookies (and localStorage if possible) for the given domain.
  function clearDataForDomain(domain) {
    // Remove all cookies exactly matching the domain.
    chrome.cookies.getAll({ domain: domain }, function(cookies) {
      if (cookies.length === 0) {
        updateStatus("No cookies found for " + domain);
        return;
      }
      let removedCount = 0;
      cookies.forEach(cookie => {
        // Construct URL needed to remove the cookie.
        let protocol = cookie.secure ? "https:" : "http:";
        let cookieUrl = protocol + "//" + cookie.domain + cookie.path;
        chrome.cookies.remove({
          url: cookieUrl,
          name: cookie.name,
          storeId: cookie.storeId
        }, function() {
          removedCount++;
          if (removedCount === cookies.length) {
            updateStatus("Cleared " + cookies.length + " cookies for " + domain);
          }
        });
      });
    });
    
    // Optionally, clear localStorage for an active tab of the domain.
    // This requires that a tab for that domain is open.
    chrome.tabs.query({}, function(tabs) {
      const matchingTabs = tabs.filter(tab => {
        try {
          const url = new URL(tab.url);
          return url.hostname === domain;
        } catch (e) {
          return false;
        }
      });
      if (matchingTabs.length > 0) {
        chrome.scripting.executeScript({
          target: { tabId: matchingTabs[0].id },
          function: function() {
            localStorage.clear();
          }
        }, () => {
          console.log("Cleared localStorage for " + domain);
        });
      }
    });
  }
  
  function updateStatus(message) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    setTimeout(() => {
      statusDiv.textContent = "";
    }, 3000);
  }
  
  document.getElementById('clearButton').addEventListener('click', function() {
    const domain = document.getElementById('domainInput').value.trim();
    if (!domain) {
      updateStatus("Please enter a domain.");
      return;
    }
    clearDataForDomain(domain);
  });
  
  document.addEventListener('DOMContentLoaded', function() {
    populateDomains();
  });