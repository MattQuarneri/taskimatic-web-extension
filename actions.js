if (!customElements.get('tab-widget')) {
  console.error('tab-widget component not loaded or registered');
}

const QUICK_READ_DEFAULT_ACTION_WORDS = ["secure", "power", "plan", "update", "efficient", "develop", "custom"];

// When the DOM is loaded, load tabs and bookmarks.
document.addEventListener('DOMContentLoaded', function() {
    initializeQuickReadControls();
    initializeTargetProcessingSwitch();

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
    
    // Analyze all browsing history on button click.
    document.getElementById('analyzeHistoryBtn').addEventListener('click', function() {
      analyzeHistory();
    });
    document.getElementById('exportHistreeBtn').addEventListener('click', function() {
      if (lastHistree) downloadJson(lastHistree, 'histree');
    });
    document.getElementById('exportHistreeLinksBtn').addEventListener('click', function() {
      if (lastHistree) downloadJson(flattenHistreeLinks(lastHistree), 'history-links');
    });
    document.getElementById('historySortSelect').addEventListener('change', function() {
      histreeSortMode = this.value;
      if (lastHistree) renderHistree(lastHistree);
    });
    document.getElementById('historySearchInput').addEventListener('input', function() {
      histreeFilter = this.value.trim().toLowerCase();
      scheduleHistreeRender();
    });
    // Save open tab URLs and titles to JSON file on button click.
    document.getElementById('save2JSON').addEventListener('click', function() {
      chrome.tabs.query({}, function(tabs) {
        downloadJson(tabs.map(tab => ({ url: tab.url, title: tab.title })), 'open-tabs');
      });
    });
  });

  function initializeTargetProcessingSwitch() {
    const toggle = document.getElementById('processTargetDataSwitch');
    const status = document.getElementById('targetProcessingStatus');
    const open = document.getElementById('openTargetDataBtn');
    if (!toggle || !status || !open) return;

    chrome.storage.local.get({ processTargetData: false }).then(({ processTargetData }) => {
      toggle.checked = Boolean(processTargetData);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.processTargetData) {
        toggle.checked = Boolean(changes.processTargetData.newValue);
      }
    });

    toggle.addEventListener('change', async () => {
      await chrome.storage.local.set({ processTargetData: toggle.checked });
      status.textContent = toggle.checked
        ? 'Get data buttons are enabled on Target order pages.'
        : 'Get data buttons are off.';
    });

    open.addEventListener('click', async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'openTargetDataWindow' });
        if (!response?.ok) throw new Error(response?.error || 'Could not open Target JSON.');
      } catch {
        status.textContent = 'Could not open the Target JSON window.';
      }
    });
  }

  // --- Content Functions ---

  function initializeQuickReadControls() {
    const simplifyButton = document.getElementById('simplifyPageBtn');
    const quickReadButton = document.getElementById('quickReadBtn');
    const resetWordsButton = document.getElementById('resetQuickReadWordsBtn');
    const actionWordsInput = document.getElementById('quickReadActionWords');

    if (!simplifyButton || !quickReadButton || !resetWordsButton || !actionWordsInput) {
      return;
    }

    chrome.storage.sync.get({
      quickReadActionWords: QUICK_READ_DEFAULT_ACTION_WORDS
    }, function(items) {
      actionWordsInput.value = normalizeQuickReadWords(items.quickReadActionWords)
        .join(', ');
    });

    simplifyButton.addEventListener('click', function() {
      simplifyPage();
    });

    quickReadButton.addEventListener('click', function() {
      const actionWords = normalizeQuickReadWords(actionWordsInput.value);
      chrome.storage.sync.set({ quickReadActionWords: actionWords }, function() {
        applyQuickRead(actionWords);
      });
    });

    resetWordsButton.addEventListener('click', function() {
      actionWordsInput.value = QUICK_READ_DEFAULT_ACTION_WORDS.join(', ');
      chrome.storage.sync.set({ quickReadActionWords: QUICK_READ_DEFAULT_ACTION_WORDS }, function() {
        updateQuickReadStatus('Action words reset.');
      });
    });
  }

  function simplifyPage() {
    updateQuickReadStatus('Simplifying page...');

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const activeTab = tabs[0];
      if (!activeTab || typeof activeTab.id !== 'number' || !canMessageTab(activeTab.url)) {
        updateQuickReadStatus('Simplify cannot run on this tab.');
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, {
        action: 'simplifyPage'
      }, function(response) {
        if (chrome.runtime.lastError) {
          updateQuickReadStatus('Refresh the page, then try Simplify again.');
          return;
        }

        if (!response || !response.ok) {
          updateQuickReadStatus(response && response.error ? response.error : 'Simplify failed on this page.');
          return;
        }

        updateQuickReadStatus(`Simplified ${response.scanned} nodes, flattened ${response.flattened}, removed ${response.removed}.`);
      });
    });
  }

  function normalizeQuickReadWords(value) {
    const words = Array.isArray(value)
      ? value
      : String(value || '').split(/[\s,]+/);

    const seen = new Set();
    return words
      .map(word => String(word).trim().toLowerCase())
      .filter(word => /^[a-z]+(?:'[a-z]+)?$/.test(word))
      .filter(word => {
        if (seen.has(word)) return false;
        seen.add(word);
        return true;
      });
  }

  function applyQuickRead(actionWords) {
    updateQuickReadStatus('Applying Quick Read...');

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const activeTab = tabs[0];
      if (!activeTab || typeof activeTab.id !== 'number' || !canMessageTab(activeTab.url)) {
        updateQuickReadStatus('Quick Read cannot run on this tab.');
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, {
        action: 'applyQuickRead',
        actionWords
      }, function(response) {
        if (chrome.runtime.lastError) {
          updateQuickReadStatus('Refresh the page, then try Quick Read again.');
          return;
        }

        if (!response || !response.ok) {
          updateQuickReadStatus(response && response.error ? response.error : 'No readable content found.');
          return;
        }

        updateQuickReadStatus(`Formatted ${response.words} words in ${response.containers} content area${response.containers === 1 ? '' : 's'}.`);
      });
    });
  }

  function canMessageTab(url) {
    return Boolean(url) &&
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('edge://') &&
      !url.startsWith('about:');
  }

  function updateQuickReadStatus(message) {
    const status = document.getElementById('quickReadStatus');
    if (!status) return;
    status.textContent = message;
    if (message) {
      setTimeout(() => {
        if (status.textContent === message) {
          status.textContent = '';
        }
      }, 3500);
    }
  }
  
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
  
  // 0 = search from the very beginning of the local history database.
  const HISTORY_SEARCH_START = 0;
  // maxResults has no documented cap; set it high enough to get everything.
  const HISTORY_MAX_RESULTS = 1000000;
  // A visit "ends" when the next visit (to any URL) begins. Cap the gap so idle
  // time (laptop asleep, browser closed) isn't counted as reading time.
  const MAX_VISIT_GAP_MS = 30 * 60 * 1000;
  const VISIT_LOOKUP_CONCURRENCY = 6;

  let lastHistree = null;

  // Analyze the full browsing history into a "histree":
  // host -> path segment -> page, with visit counts and time spent per node.
  async function analyzeHistory() {
    const analyzeBtn = document.getElementById('analyzeHistoryBtn');
    analyzeBtn.disabled = true;
    try {
      updateHistoryStatus('Searching all history...');
      const items = await chrome.history.search({
        text: '',
        startTime: HISTORY_SEARCH_START,
        maxResults: HISTORY_MAX_RESULTS
      });
      updateHistoryStatus(`Found ${items.length} pages. Reading visit timestamps...`);

      const visitsByUrl = await collectVisits(items);
      const timeByUrl = computeVisitDurations(visitsByUrl);
      lastHistree = buildHistree(items, timeByUrl);
      renderHistree(lastHistree);

      document.getElementById('exportHistreeBtn').disabled = false;
      document.getElementById('exportHistreeLinksBtn').disabled = false;
      updateHistoryStatus(
        `Analyzed ${lastHistree.uniqueUrls} pages, ${lastHistree.totalVisits} visits, ` +
        `${formatDuration(lastHistree.totalTimeMs)} total. Expand a site below.`
      );
    } catch (e) {
      updateHistoryStatus('History analysis failed: ' + e.message);
    } finally {
      analyzeBtn.disabled = false;
    }
  }

  // chrome.history.search only returns the LAST visit time per URL, so getVisits
  // is the only way to get every visit timestamp (needed for durations).
  // Runs with limited concurrency and progress updates.
  async function collectVisits(items) {
    const visitsByUrl = new Map();
    let next = 0;
    let done = 0;
    async function worker() {
      while (next < items.length) {
        const item = items[next++];
        try {
          visitsByUrl.set(item.url, await chrome.history.getVisits({ url: item.url }));
        } catch (e) {
          visitsByUrl.set(item.url, []);
        }
        done++;
        if (done % 200 === 0) {
          updateHistoryStatus(`Reading visit timestamps ${done}/${items.length}...`);
        }
      }
    }
    const workers = [];
    for (let i = 0; i < VISIT_LOOKUP_CONCURRENCY; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return visitsByUrl;
  }

  // Rough per-URL time: merge every visit into one global timeline; each visit
  // is "open" until the next visit starts (capped at MAX_VISIT_GAP_MS).
  function computeVisitDurations(visitsByUrl) {
    const timeline = [];
    visitsByUrl.forEach((visits, url) => {
      visits.forEach(visit => timeline.push({ time: visit.visitTime, url }));
    });
    timeline.sort((a, b) => a.time - b.time);

    const timeByUrl = new Map();
    for (let i = 0; i < timeline.length; i++) {
      const gap = i + 1 < timeline.length ? timeline[i + 1].time - timeline[i].time : 0;
      const duration = Math.min(Math.max(gap, 0), MAX_VISIT_GAP_MS);
      timeByUrl.set(timeline[i].url, (timeByUrl.get(timeline[i].url) || 0) + duration);
    }
    return timeByUrl;
  }

  function newHistreeNode(name) {
    return { name: name, visits: 0, timeMs: 0, lastVisit: 0, pages: {}, children: {} };
  }

  // Build the histree. Pages are keyed by URL with query string/hash stripped,
  // so tracking-parameter variants of the same page merge into one entry.
  function buildHistree(items, timeByUrl) {
    const root = {
      generatedAt: new Date().toISOString(),
      visitGapCapMs: MAX_VISIT_GAP_MS,
      uniqueUrls: 0,
      totalVisits: 0,
      totalTimeMs: 0,
      hosts: {}
    };

    items.forEach(item => {
      let parsed;
      try {
        parsed = new URL(item.url);
      } catch (e) {
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

      const visits = item.visitCount || 0;
      const timeMs = timeByUrl.get(item.url) || 0;
      const lastVisit = item.lastVisitTime || 0;
      root.uniqueUrls++;
      root.totalVisits += visits;
      root.totalTimeMs += timeMs;

      let node = root.hosts[parsed.hostname];
      if (!node) {
        node = newHistreeNode(parsed.hostname);
        root.hosts[parsed.hostname] = node;
      }
      node.visits += visits;
      node.timeMs += timeMs;
      node.lastVisit = Math.max(node.lastVisit, lastVisit);

      parsed.pathname.split('/').filter(Boolean).forEach(segment => {
        let name = segment;
        try { name = decodeURIComponent(segment); } catch (e) { /* keep raw segment */ }
        if (!node.children[name]) node.children[name] = newHistreeNode(name);
        node = node.children[name];
        node.visits += visits;
        node.timeMs += timeMs;
        node.lastVisit = Math.max(node.lastVisit, lastVisit);
      });

      const pageUrl = parsed.origin + parsed.pathname;
      const page = node.pages[pageUrl];
      if (page) {
        page.visits += visits;
        page.timeMs += timeMs;
        page.variants++;
        page.lastVisit = Math.max(page.lastVisit, lastVisit);
        if (!page.title && item.title) page.title = item.title;
      } else {
        node.pages[pageUrl] = {
          url: pageUrl,
          title: item.title || pageUrl,
          visits: visits,
          timeMs: timeMs,
          avgMs: 0,
          lastVisit: lastVisit,
          variants: 1
        };
      }
    });

    // Averages can only be computed after all URL variants are merged.
    Object.values(root.hosts).forEach(function computeAverages(node) {
      Object.values(node.pages).forEach(page => {
        page.avgMs = page.visits > 0 ? Math.round(page.timeMs / page.visits) : 0;
      });
      Object.values(node.children).forEach(computeAverages);
    });

    return root;
  }
  
  // Histree view state: 'time' | 'popularity' | 'recency', plus the search text.
  let histreeSortMode = 'time';
  let histreeFilter = '';
  let histreeRenderTimer = null;

  // Comparator works for both tree nodes and page entries.
  function histreeNodeComparator(a, b) {
    if (histreeSortMode === 'recency') return b.lastVisit - a.lastVisit;
    if (histreeSortMode === 'popularity') return b.visits - a.visits || b.timeMs - a.timeMs;
    return b.timeMs - a.timeMs || b.visits - a.visits;
  }

  function nodeSummaryText(node) {
    let text = `${node.name} — ${node.visits} visits · ${formatDuration(node.timeMs)}`;
    if (histreeSortMode === 'recency' && node.lastVisit) {
      text += ` · last ${new Date(node.lastVisit).toLocaleString()}`;
    }
    return text;
  }

  // Return a pruned copy of the node keeping only matches (host/segment name,
  // page title or URL). A node that matches itself keeps its whole subtree.
  function filterHistreeNode(node, query) {
    const selfMatch = node.name.toLowerCase().includes(query);
    const pages = {};
    const children = {};
    if (selfMatch) {
      Object.assign(pages, node.pages);
      Object.assign(children, node.children);
    } else {
      Object.values(node.pages).forEach(page => {
        if (page.title.toLowerCase().includes(query) || page.url.toLowerCase().includes(query)) {
          pages[page.url] = page;
        }
      });
      Object.values(node.children).forEach(child => {
        const pruned = filterHistreeNode(child, query);
        if (pruned) children[pruned.name] = pruned;
      });
    }
    if (!selfMatch && Object.keys(pages).length === 0 && Object.keys(children).length === 0) {
      return null;
    }
    return {
      name: node.name,
      visits: node.visits,
      timeMs: node.timeMs,
      lastVisit: node.lastVisit,
      pages: pages,
      children: children
    };
  }

  // Debounced re-render for search-as-you-type.
  function scheduleHistreeRender() {
    clearTimeout(histreeRenderTimer);
    histreeRenderTimer = setTimeout(() => {
      if (lastHistree) renderHistree(lastHistree);
    }, 150);
  }

  // Render the histree as a collapsible tree. Children render lazily on first
  // expand so huge histories don't freeze the popup. While filtering, matched
  // nodes auto-expand so the matches are visible.
  function renderHistree(histree) {
    const container = document.getElementById('historyContainer');
    container.innerHTML = '';
    let hosts = Object.values(histree.hosts);
    const filtering = histreeFilter.length > 0;
    if (filtering) {
      hosts = hosts.map(host => filterHistreeNode(host, histreeFilter)).filter(Boolean);
      if (hosts.length === 0) {
        container.textContent = 'No matches.';
        return;
      }
    }
    hosts
      .sort(histreeNodeComparator)
      .forEach(host => container.appendChild(createTreeDetails(host, filtering)));
  }

  function createTreeDetails(node, expand) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = nodeSummaryText(node);
    details.appendChild(summary);
    details.addEventListener('toggle', function onToggle() {
      if (!details.open) return;
      details.removeEventListener('toggle', onToggle);
      renderNodeChildren(details, node, expand);
    });
    if (expand) details.open = true;
    return details;
  }

  function renderNodeChildren(details, node, expand) {
    const list = document.createElement('ul');

    Object.values(node.pages)
      .sort(histreeNodeComparator)
      .forEach(page => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = page.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = page.title;
        li.appendChild(a);
        const variants = page.variants > 1 ? ` · ${page.variants} url variants` : '';
        const recency = histreeSortMode === 'recency' && page.lastVisit
          ? ` · last ${new Date(page.lastVisit).toLocaleString()}`
          : '';
        li.appendChild(document.createTextNode(
          ` — ${page.visits} visits · ${formatDuration(page.timeMs)} total · ${formatDuration(page.avgMs)} avg${variants}${recency}`
        ));
        list.appendChild(li);
      });

    Object.values(node.children)
      .sort(histreeNodeComparator)
      .forEach(child => {
        const li = document.createElement('li');
        li.appendChild(createTreeDetails(child, expand));
        list.appendChild(li);
      });

    details.appendChild(list);
  }
  
  function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  // Flatten the histree into a sorted list of page links for export.
  function flattenHistreeLinks(histree) {
    const links = [];
    Object.values(histree.hosts).forEach(function walk(node) {
      Object.values(node.pages).forEach(page => links.push(page));
      Object.values(node.children).forEach(walk);
    });
    return links.sort((a, b) => b.timeMs - a.timeMs || b.visits - a.visits);
  }

  function downloadJson(data, filenamePrefix) {
    const json = JSON.stringify(data, null, 2);
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

    a.download = `${filenamePrefix}-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function updateHistoryStatus(message) {
    const status = document.getElementById('historyStatus');
    if (status) status.textContent = message;
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
