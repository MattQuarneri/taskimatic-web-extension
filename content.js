// content.js

let baseElement = null;
let branchRoot = null;
let lastRightClickedElement = null;
let selectedElement = null;
let pathSelectedElement = null;
let breadcrumbOverlay = null;

const QUICK_READ_COMMON_WORDS = ["is", "a", "the", "and"];
const QUICK_READ_INTERROGATIVE_WORDS = ["who", "what", "when", "where", "how", "why", "which", "whom", "whose"];
const QUICK_READ_DEFAULT_ACTION_WORDS = ["secure", "power", "plan", "update", "efficient", "develop", "custom"];
const QUICK_READ_EXCLUDED_TAGS = new Set([
  "A", "BUTTON", "CANVAS", "CODE", "FORM", "IFRAME", "IMG", "INPUT", "NOSCRIPT",
  "OPTION", "PRE", "SCRIPT", "SELECT", "STYLE", "SVG", "TEXTAREA", "VIDEO"
]);

// ============================================================================
// TABLE ANALYSIS SYSTEM
// Analyzes HTML elements to extract tabular data with structure inference
// ============================================================================

/**
 * Main entry point: Analyzes an element and extracts tabular data
 * @param {HTMLElement} el - The element to analyze
 * @return {Object} Structured table data with metadata
 */
function analyzeTableElement(el) {
  let rawRows = [];
  let sourceType = 'unknown';
  
  // Strategy 1: Semantic HTML table
  if (el.tagName === 'TABLE' || el.querySelector('table')) {
    const table = el.tagName === 'TABLE' ? el : el.querySelector('table');
    rawRows = extractFromSemanticTable(table);
    sourceType = 'semantic-table';
  }
  // Strategy 2: Elements with table ARIA roles
  else if (el.getAttribute('role') === 'table' || el.querySelector('[role="table"]')) {
    const tableEl = el.getAttribute('role') === 'table' ? el : el.querySelector('[role="table"]');
    rawRows = extractFromAriaTable(tableEl);
    sourceType = 'aria-table';
  }
  // Strategy 3: CSS Grid layout
  else if (isGridLayout(el)) {
    rawRows = extractFromGridLayout(el);
    sourceType = 'css-grid';
  }
  // Strategy 4: Repeated child structures (div-based tables)
  else if (hasRepeatedStructure(el)) {
    rawRows = extractFromRepeatedStructure(el);
    sourceType = 'repeated-structure';
  }
  // Strategy 5: Fallback to text-based parsing
  else {
    rawRows = extractFromText(el.innerText);
    sourceType = 'text-fallback';
  }
  
  // Infer structure (headers, footers, title rows)
  const structure = inferTableStructure(rawRows);
  
  return {
    sourceType,
    ...structure
  };
}

/**
 * Extract rows from a semantic HTML table
 */
function extractFromSemanticTable(table) {
  const rows = [];
  
  // Process thead
  const thead = table.querySelector('thead');
  if (thead) {
    for (const tr of thead.querySelectorAll('tr')) {
      rows.push({
        cells: extractCellsFromTr(tr),
        source: 'thead',
        isHeader: true
      });
    }
  }
  
  // Process tbody (or direct tr children if no tbody)
  const tbody = table.querySelector('tbody');
  const bodyRows = tbody ? tbody.querySelectorAll('tr') : table.querySelectorAll(':scope > tr');
  for (const tr of bodyRows) {
    // Skip if already processed in thead
    if (thead && thead.contains(tr)) continue;
    
    const cells = extractCellsFromTr(tr);
    const hasThCells = tr.querySelectorAll('th').length > 0;
    
    rows.push({
      cells,
      source: 'tbody',
      isHeader: hasThCells && tr.querySelectorAll('td').length === 0
    });
  }
  
  // Process tfoot
  const tfoot = table.querySelector('tfoot');
  if (tfoot) {
    for (const tr of tfoot.querySelectorAll('tr')) {
      rows.push({
        cells: extractCellsFromTr(tr),
        source: 'tfoot',
        isFooter: true
      });
    }
  }
  
  return rows;
}

/**
 * Extract cell values from a table row
 */
function extractCellsFromTr(tr) {
  const cells = [];
  for (const cell of tr.querySelectorAll('th, td')) {
    const colspan = parseInt(cell.getAttribute('colspan')) || 1;
    const value = cell.innerText.trim();
    
    // Handle colspan by repeating the value or adding empty cells
    cells.push({ value, isHeader: cell.tagName === 'TH' });
    for (let i = 1; i < colspan; i++) {
      cells.push({ value: '', isHeader: cell.tagName === 'TH', spanned: true });
    }
  }
  return cells;
}

/**
 * Extract rows from ARIA table roles
 */
function extractFromAriaTable(tableEl) {
  const rows = [];
  const rowEls = tableEl.querySelectorAll('[role="row"]');
  
  for (const rowEl of rowEls) {
    const cells = [];
    const cellEls = rowEl.querySelectorAll('[role="cell"], [role="columnheader"], [role="rowheader"], [role="gridcell"]');
    
    for (const cellEl of cellEls) {
      const role = cellEl.getAttribute('role');
      cells.push({
        value: cellEl.innerText.trim(),
        isHeader: role === 'columnheader' || role === 'rowheader'
      });
    }
    
    const isHeaderRow = cells.length > 0 && cells.every(c => c.isHeader);
    rows.push({ cells, source: 'aria', isHeader: isHeaderRow });
  }
  
  return rows;
}

/**
 * Check if element uses CSS Grid layout
 */
function isGridLayout(el) {
  const style = window.getComputedStyle(el);
  return style.display === 'grid' || style.display === 'inline-grid';
}

/**
 * Extract rows from CSS Grid layout
 */
function extractFromGridLayout(el) {
  const style = window.getComputedStyle(el);
  const columns = style.gridTemplateColumns.split(' ').filter(c => c && c !== 'none').length;
  
  if (columns === 0) return extractFromText(el.innerText);
  
  const children = Array.from(el.children);
  const rows = [];
  
  for (let i = 0; i < children.length; i += columns) {
    const rowCells = children.slice(i, i + columns).map(child => ({
      value: child.innerText.trim(),
      isHeader: false
    }));
    rows.push({ cells: rowCells, source: 'grid' });
  }
  
  return rows;
}

/**
 * Check if element has repeated child structures (common in div-based tables)
 */
function hasRepeatedStructure(el) {
  const children = Array.from(el.children);
  if (children.length < 2) return false;
  
  // Check if children have similar structure (same tag, similar class patterns)
  const signatures = children.slice(0, Math.min(5, children.length)).map(getElementSignature);
  const uniqueSignatures = new Set(signatures);
  
  // If most children have the same signature, it's likely a repeated structure
  return uniqueSignatures.size <= 2 && children.length >= 3;
}

/**
 * Get a signature string for an element's structure
 */
function getElementSignature(el) {
  const childTags = Array.from(el.children).map(c => c.tagName).join(',');
  const childCount = el.children.length;
  return `${el.tagName}:${childCount}:${childTags.substring(0, 50)}`;
}

/**
 * Extract rows from repeated div/element structures
 */
function extractFromRepeatedStructure(el) {
  const rows = [];
  const children = Array.from(el.children);
  
  for (const child of children) {
    const cells = [];
    
    // If the child has children, treat each as a cell
    if (child.children.length > 0) {
      for (const cellEl of child.children) {
        cells.push({
          value: cellEl.innerText.trim(),
          isHeader: false
        });
      }
    } else {
      // Single cell row
      cells.push({
        value: child.innerText.trim(),
        isHeader: false
      });
    }
    
    if (cells.some(c => c.value)) {
      rows.push({ cells, source: 'repeated' });
    }
  }
  
  return rows;
}

/**
 * Fallback: Extract rows from plain text
 */
function extractFromText(text) {
  const rows = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (line.trim() === '') continue;
    
    // Try tab-separated first, then multiple spaces, then single values
    let values;
    if (line.includes('\t')) {
      values = line.split('\t');
    } else if (line.includes('  ')) {
      values = line.split(/\s{2,}/);
    } else {
      values = [line];
    }
    
    const cells = values.map(v => ({ value: v.trim(), isHeader: false }));
    if (cells.some(c => c.value)) {
      rows.push({ cells, source: 'text' });
    }
  }
  
  return rows;
}

/**
 * Infer table structure: identify headers, footers, title rows, and data rows
 */
function inferTableStructure(rawRows) {
  if (rawRows.length === 0) {
    return { titleRows: [], headerRow: null, dataRows: [], footerRows: [], columnCount: 0 };
  }
  
  // Count cells per row
  const cellCounts = rawRows.map(r => r.cells.length);
  
  // Find the "mode" (most common cell count) - this represents data rows
  const countFrequency = {};
  cellCounts.forEach(c => { countFrequency[c] = (countFrequency[c] || 0) + 1; });
  const modeCount = Object.entries(countFrequency)
    .sort((a, b) => b[1] - a[1])[0][0];
  const expectedColumnCount = parseInt(modeCount);
  
  // Classify rows
  const result = {
    titleRows: [],
    headerRow: null,
    dataRows: [],
    footerRows: [],
    columnCount: expectedColumnCount
  };
  
  // Find the first row that matches the expected column count
  let dataStartIndex = rawRows.findIndex(r => r.cells.length === expectedColumnCount);
  if (dataStartIndex === -1) dataStartIndex = 0;
  
  // Rows before the data section with different column counts are title rows
  for (let i = 0; i < dataStartIndex; i++) {
    result.titleRows.push({
      type: 'title',
      values: rawRows[i].cells.map(c => c.value)
    });
  }
  
  // Find where data rows end (look for footer pattern at the end)
  let dataEndIndex = rawRows.length;
  for (let i = rawRows.length - 1; i > dataStartIndex; i--) {
    const row = rawRows[i];
    // Footer indicators: different column count, marked as footer, or contains summary words
    if (row.isFooter || 
        row.cells.length !== expectedColumnCount ||
        containsFooterIndicators(row)) {
      dataEndIndex = i;
    } else {
      break;
    }
  }
  
  // Process the main data section
  let headerFound = false;
  for (let i = dataStartIndex; i < dataEndIndex; i++) {
    const row = rawRows[i];
    
    // First row in data section: check if it's a header
    if (!headerFound && shouldBeHeader(row, rawRows, i, expectedColumnCount)) {
      result.headerRow = {
        type: 'header',
        values: row.cells.map(c => c.value)
      };
      headerFound = true;
    } else {
      result.dataRows.push({
        type: 'data',
        values: row.cells.map(c => c.value)
      });
    }
  }
  
  // Footer rows
  for (let i = dataEndIndex; i < rawRows.length; i++) {
    result.footerRows.push({
      type: 'footer',
      values: rawRows[i].cells.map(c => c.value)
    });
  }
  
  return result;
}

/**
 * Determine if a row should be treated as a header
 */
function shouldBeHeader(row, allRows, index, expectedColumnCount) {
  // Already marked as header from HTML
  if (row.isHeader) return true;
  if (row.source === 'thead') return true;
  
  // All cells are marked as headers (th elements)
  if (row.cells.every(c => c.isHeader)) return true;
  
  // First row with matching column count, followed by more rows with same count
  if (index === 0 || allRows[index - 1].cells.length !== expectedColumnCount) {
    const followingRows = allRows.slice(index + 1, index + 4);
    const sameCountFollowing = followingRows.filter(r => r.cells.length === expectedColumnCount).length;
    if (sameCountFollowing >= 2) {
      // Check if values look like headers (non-numeric, shorter text)
      const values = row.cells.map(c => c.value);
      const looksLikeHeaders = values.every(v => {
        const trimmed = v.trim();
        return trimmed.length < 50 && !/^[\d,.$€£¥%+-]+$/.test(trimmed);
      });
      return looksLikeHeaders;
    }
  }
  
  return false;
}

/**
 * Check if a row contains footer indicators
 */
function containsFooterIndicators(row) {
  const text = row.cells.map(c => c.value).join(' ').toLowerCase();
  const footerWords = ['total', 'sum', 'average', 'avg', 'count', 'subtotal', 'grand total'];
  return footerWords.some(word => text.includes(word));
}

// ============================================================================
// OUTPUT FORMATTERS
// ============================================================================

/**
 * Format table structure as TSV (Tab-Separated Values)
 * Best for pasting into spreadsheets
 */
function formatAsTSV(structure) {
  const lines = [];
  
  // Title rows
  for (const row of structure.titleRows) {
    lines.push(row.values.join('\t'));
  }
  
  // Add blank line after titles if there are any
  if (structure.titleRows.length > 0 && (structure.headerRow || structure.dataRows.length > 0)) {
    lines.push('');
  }
  
  // Header row
  if (structure.headerRow) {
    lines.push(structure.headerRow.values.join('\t'));
  }
  
  // Data rows
  for (const row of structure.dataRows) {
    lines.push(row.values.join('\t'));
  }
  
  // Footer rows
  if (structure.footerRows.length > 0) {
    lines.push(''); // Blank line before footer
    for (const row of structure.footerRows) {
      lines.push(row.values.join('\t'));
    }
  }
  
  return lines.join('\n');
}

/**
 * Format table structure as CSV
 */
function formatAsCSV(structure) {
  const escapeCSV = (value) => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  };
  
  const lines = [];
  
  // Title rows
  for (const row of structure.titleRows) {
    lines.push(row.values.map(escapeCSV).join(','));
  }
  
  if (structure.titleRows.length > 0 && (structure.headerRow || structure.dataRows.length > 0)) {
    lines.push('');
  }
  
  // Header row
  if (structure.headerRow) {
    lines.push(structure.headerRow.values.map(escapeCSV).join(','));
  }
  
  // Data rows
  for (const row of structure.dataRows) {
    lines.push(row.values.map(escapeCSV).join(','));
  }
  
  // Footer rows
  if (structure.footerRows.length > 0) {
    lines.push('');
    for (const row of structure.footerRows) {
      lines.push(row.values.map(escapeCSV).join(','));
    }
  }
  
  return lines.join('\n');
}

/**
 * Format table structure as Markdown table
 */
function formatAsMarkdown(structure) {
  const lines = [];
  const columnCount = structure.columnCount || 1;
  
  // Title rows (as paragraphs above the table)
  for (const row of structure.titleRows) {
    lines.push('**' + row.values.join(' ') + '**');
    lines.push('');
  }
  
  // Header row
  if (structure.headerRow) {
    lines.push('| ' + structure.headerRow.values.join(' | ') + ' |');
    lines.push('| ' + structure.headerRow.values.map(() => '---').join(' | ') + ' |');
  } else if (structure.dataRows.length > 0) {
    // Create generic headers if none exist
    const headers = Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');
  }
  
  // Data rows
  for (const row of structure.dataRows) {
    // Pad row to match column count
    const paddedValues = [...row.values];
    while (paddedValues.length < columnCount) paddedValues.push('');
    lines.push('| ' + paddedValues.join(' | ') + ' |');
  }
  
  // Footer rows
  if (structure.footerRows.length > 0) {
    lines.push(''); // Blank line
    for (const row of structure.footerRows) {
      lines.push('**' + row.values.join(' | ') + '**');
    }
  }
  
  return lines.join('\n');
}

/**
 * Format table structure as structured JSON
 */
function formatAsJSON(structure, elementMeta = {}) {
  return JSON.stringify({
    ...elementMeta,
    table: structure
  }, null, 2);
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use analyzeTableElement instead
 */
function parseTableText(text) {
  const rows = extractFromText(text);
  return inferTableStructure(rows);
}


// Store the element on which the user right-clicked.
document.addEventListener("contextmenu", (e) => {
  lastRightClickedElement = e.target;
}, true);

function safeHighlight(el) {
  try {
    // Try to get properties, attach events, etc.
    const rect = el.getBoundingClientRect();
    // If we get here without an error, use the lightweight approach.
    highlightElement(el);
  } catch (err) {
    if (err.name === "SecurityError") {
      // Fallback: use a heavy approach.
      const clone = el.cloneNode(true);
      renderOverlay(clone);
    } else {
      console.error("Unexpected error:", err);
    }
  }
}

// Listen for the message from the background script to activate the mode.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const isTopFrame = window === window.top;
  if (!isTopFrame && message.action !== "activateGetPath") {
    return;
  }

  if (message.action === "activateGetPath") {
    if (!lastRightClickedElement) {
      sendResponse({
        ok: false,
        error: "No element was captured. Refresh the page and try Get Path again."
      });
      return;
    }

    try {
      renderBreadcrumbPath(lastRightClickedElement);
      sendResponse({ ok: true });
    } catch (error) {
      console.error("Get Path failed:", error);
      sendResponse({ ok: false, error: "Get Path could not render on this page." });
    }
    return;
  }
  if (message.action === "activateGetData" && lastRightClickedElement) {
      closeBreadcrumbPath();
      baseElement = findLargestBranch(lastRightClickedElement);
      branchRoot = baseElement;
      selectedElement = baseElement;
      safeHighlight(selectedElement);
      attachSelectionListeners(selectedElement);
  }
  // Handle format change from context menu or popup
  if (message.action === "setOutputFormat" && message.format) {
    setOutputFormat(message.format);
    showPopupMessage(`Output format: ${message.format.toUpperCase()}`);
  }
  if (message.type === "updateDomainCounts") {
    const contentDiv = document.getElementById("domainOverlayContent");
    if (contentDiv) {
      let html = "";
      for (const domain in message.counts) {
        html += `${domain}: ${message.counts[domain].count} [${message.counts[domain].formatedBytes}]<br>`;
      }
      contentDiv.innerHTML = html;
    }
  }
  if (message.type === "scanForHighTextElements") {
    scanForHighTextElements();
  }
  if (message.action === "applyQuickRead") {
    try {
      const result = applyQuickReadFormatting(message);
      sendResponse({ ok: true, ...result });
    } catch (error) {
      console.error("Quick Read failed:", error);
      sendResponse({ ok: false, error: "Quick Read failed on this page." });
    }
  }
  if (message.action === "simplifyPage") {
    try {
      const result = simplifyPageStructure();
      sendResponse({ ok: true, ...result });
    } catch (error) {
      console.error("Simplify failed:", error);
      sendResponse({ ok: false, error: "Simplify failed on this page." });
    }
  }
});

// Traverses upward from the given element until the parent's child count drops.
function findLargestBranch(el) {
  let current = el;
  while (current.parentElement) {
    // This heuristic goes up the DOM until the parent's children count is lower.
    if (current.parentElement.children.length < current.children.length) {
      break;
    }
    current = current.parentElement;
  }
  return current;
}

function cloneElementData(el) {
  // Use cloneNode to get a deep copy. Note this is static.
  const clone = el.cloneNode(true);
  // Optionally remove attributes that might interfere.
  return clone;
}

function renderOverlay(clonedEl) {
  // Create a container for your custom UI.
  const container = document.createElement("div");
  container.id = "custom-overlay";
  container.style.position = "fixed";
  container.style.top = "20px";
  container.style.right = "20px";
  container.style.background = "rgba(255,255,255,0.9)";
  container.style.border = "1px solid #ccc";
  container.style.padding = "10px";
  container.style.zIndex = "100000";

  // Append the cloned element or extract its properties.
  container.appendChild(clonedEl);
  document.body.appendChild(container);
}

// Applies a CSS outline to the element.
function highlightElement(el) {
  // First remove any existing overlay.
  removeHighlightOverlay();

  const rect = el.getBoundingClientRect();
  const overlay = document.createElement("div");
  const isPathHighlight = pathSelectedElement === el;
  const canUseTopLayer = isPathHighlight && typeof overlay.showPopover === "function";
  overlay.id = "highlight-overlay";
  overlay.setAttribute("aria-hidden", "true");
  if (canUseTopLayer) {
    overlay.setAttribute("popover", "manual");
  }
  setImportantStyles(overlay, {
    display: "block",
    position: isPathHighlight ? "fixed" : "absolute",
    top: rect.top + (isPathHighlight ? 0 : window.scrollY) + "px",
    left: rect.left + (isPathHighlight ? 0 : window.scrollX) + "px",
    right: "auto",
    bottom: "auto",
    width: rect.width + "px",
    height: rect.height + "px",
    margin: "0",
    padding: "0",
    border: "2px solid red",
    boxSizing: "border-box",
    background: "transparent",
    overflow: "visible",
    visibility: "visible",
    opacity: "1",
    transform: "none",
    clip: "auto",
    clipPath: "none",
    pointerEvents: "none",
    zIndex: "2147483646"
  });

  (isPathHighlight ? document.documentElement : document.body).appendChild(overlay);
  if (canUseTopLayer) {
    try {
      overlay.showPopover();
    } catch (error) {
      // The maximum z-index remains as a fallback if the top layer is unavailable.
      overlay.removeAttribute("popover");
    }
  }
}

function removeHighlightOverlay() {
  const existing = document.getElementById("highlight-overlay");
  if (existing) {
    existing.parentNode.removeChild(existing);
  }
}

function setImportantStyles(element, styles) {
  Object.entries(styles).forEach(([property, value]) => {
    const cssProperty = property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    element.style.setProperty(cssProperty, value, "important");
  });
}

// Renders the DOM ancestry for an element and lets each breadcrumb become the
// highlighted selection without affecting the page's normal click behavior.
function renderBreadcrumbPath(element) {
  closeBreadcrumbPath();

  const path = getPath(element);
  if (path.length === 0) return;

  pathSelectedElement = path[path.length - 1];
  safeHighlight(pathSelectedElement);

  const host = document.createElement("div");
  host.id = "taskimatic-breadcrumbs";
  host.setAttribute("data-taskimatic-owned", "true");
  const canUseTopLayer = typeof host.showPopover === "function";
  if (canUseTopLayer) {
    host.setAttribute("popover", "manual");
  }
  setImportantStyles(host, {
    display: "block",
    position: "fixed",
    top: "auto",
    right: "16px",
    bottom: "16px",
    left: "16px",
    width: "auto",
    height: "auto",
    maxWidth: "none",
    maxHeight: "none",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    overflow: "visible",
    visibility: "visible",
    opacity: "1",
    transform: "none",
    clip: "auto",
    clipPath: "none",
    pointerEvents: "auto",
    zIndex: "2147483647"
  });
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      top: auto;
      right: 16px;
      bottom: 16px;
      left: 16px;
      width: auto;
      height: auto;
      margin: 0;
      padding: 0;
      border: 0;
      overflow: visible;
      background: transparent;
      z-index: 2147483647;
      color-scheme: light;
    }
    .panel {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 100%;
      padding: 10px 12px;
      border: 1px solid #c7cdd4;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 4px 18px rgba(0, 0, 0, .24);
      color: #202124;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .label {
      flex: 0 0 auto;
      font-weight: 600;
    }
    nav {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .crumb {
      flex: 0 0 auto;
      margin: 0;
      padding: 4px 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: #185abc;
      font: inherit;
      cursor: pointer;
    }
    .crumb:hover,
    .crumb:focus-visible {
      border-color: #9aa0a6;
      outline: none;
      background: #f1f3f4;
    }
    .crumb[aria-current="location"] {
      border-color: #d93025;
      background: #fce8e6;
      color: #a50e0e;
      font-weight: 600;
    }
    .separator {
      flex: 0 0 auto;
      padding: 0 2px;
      color: #80868b;
      user-select: none;
    }
    .close {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #5f6368;
      font: 20px/28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .close:hover,
    .close:focus-visible {
      outline: none;
      background: #f1f3f4;
      color: #202124;
    }
  `;

  const panel = document.createElement("div");
  panel.className = "panel";

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "DOM path";

  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "DOM path");

  const buttons = [];
  path.forEach((pathElement, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "separator";
      separator.setAttribute("aria-hidden", "true");
      separator.textContent = "\u203a";
      nav.appendChild(separator);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "crumb";
    button.textContent = getElementBreadcrumbLabel(pathElement);
    button.title = button.textContent;
    if (pathElement === pathSelectedElement) {
      button.setAttribute("aria-current", "location");
    }
    button.addEventListener("click", () => {
      if (!pathElement.isConnected) {
        closeBreadcrumbPath();
        return;
      }

      pathSelectedElement = pathElement;
      buttons.forEach(item => item.removeAttribute("aria-current"));
      button.setAttribute("aria-current", "location");
      safeHighlight(pathSelectedElement);
    });
    buttons.push(button);
    nav.appendChild(button);
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close";
  closeButton.setAttribute("aria-label", "Close DOM path");
  closeButton.title = "Close";
  closeButton.textContent = "\u00d7";
  closeButton.addEventListener("click", closeBreadcrumbPath);

  panel.append(label, nav, closeButton);
  shadow.append(style, panel);
  document.documentElement.appendChild(host);
  breadcrumbOverlay = host;
  if (canUseTopLayer) {
    try {
      host.showPopover();
    } catch (error) {
      // Fixed positioning plus maximum z-index is the compatibility fallback.
      host.removeAttribute("popover");
    }
  }

  // Start with the selected (last) breadcrumb in view when the path is long.
  buttons[buttons.length - 1].scrollIntoView({ block: "nearest", inline: "end" });
  window.addEventListener("scroll", refreshPathHighlight, true);
  window.addEventListener("resize", refreshPathHighlight);
  document.addEventListener("keydown", onBreadcrumbKeyDown, true);
}

function getPath(element) {
  const path = [];
  let current = element instanceof Element
    ? element
    : element && element.parentElement;

  while (current) {
    path.unshift(current);
    if (current === document.body) break;
    current = current.parentElement;
  }

  // Normal page content is rooted at body. Retain the actual path for edge
  // cases such as a context menu opened directly on the html element.
  return path;
}

function getElementBreadcrumbLabel(element) {
  let label = element.tagName.toLowerCase();

  if (element.id) {
    label += `#${element.id}`;
  } else if (element.classList.length > 0) {
    label += Array.from(element.classList)
      .slice(0, 2)
      .map(className => `.${className}`)
      .join("");
  } else if (element.parentElement) {
    const matchingSiblings = Array.from(element.parentElement.children)
      .filter(sibling => sibling.tagName === element.tagName);
    if (matchingSiblings.length > 1) {
      label += `:nth-of-type(${matchingSiblings.indexOf(element) + 1})`;
    }
  }

  return label;
}

function refreshPathHighlight() {
  if (!breadcrumbOverlay || !pathSelectedElement || !pathSelectedElement.isConnected) return;
  highlightElement(pathSelectedElement);
}

function onBreadcrumbKeyDown(event) {
  if (event.key === "Escape") {
    closeBreadcrumbPath();
  }
}

function closeBreadcrumbPath() {
  window.removeEventListener("scroll", refreshPathHighlight, true);
  window.removeEventListener("resize", refreshPathHighlight);
  document.removeEventListener("keydown", onBreadcrumbKeyDown, true);

  if (breadcrumbOverlay) {
    breadcrumbOverlay.remove();
  }
  breadcrumbOverlay = null;
  pathSelectedElement = null;
  removeHighlightOverlay();
}

// Attaches event listeners to allow mousewheel navigation, cancellation, and click-to-copy.
function attachSelectionListeners(el) {
  el.addEventListener("wheel", onWheelHandler, { passive: false, capture: true });
  el.addEventListener("mouseleave", onMouseLeaveHandler);
  el.addEventListener("click", onClickHandler);
}

// Handles mousewheel events to adjust the selection.
function onWheelHandler(e) {
  if (!e.shiftKey) return;
  e.preventDefault();

  if (e.deltaY < 0) {
    // Scroll up: if a parent exists, select it.
    if (branchRoot !== baseElement && branchRoot.parentElement && 
        baseElement.contains(branchRoot.parentElement)) 
    {
      branchRoot = branchRoot.parentElement;
      selectedElement = branchRoot;
    }
  } else {
    // Scroll down: cycle through branchRoot's immediate children
    const children = branchRoot.children;
    if (!children || children.length === 0) return;

    // If only one child, descend automatically.
    if (children.length === 1) {
      branchRoot = children[0];
      selectedElement = branchRoot;
    } else {
      // If selectedElement is not one of branchRoot's children, start with the first.
      if (!Array.from(children).includes(selectedElement)) {
        selectedElement = children[0];
      } else {
        const siblings = Array.from(children);
        let idx = siblings.indexOf(selectedElement);
        idx = (idx + 1) % siblings.length;
        selectedElement = siblings[idx];
      }
    }
  }
  highlightElement(selectedElement);
  attachSelectionListeners(selectedElement);
}

// Cancels the selection if the mouse leaves the element.
function onMouseLeaveHandler(e) {
  removeHighlightOverlay(selectedElement);
  selectedElement = null;
}

// Current output format preference (can be changed via context menu or settings)
let outputFormat = 'tsv'; // Options: 'tsv', 'csv', 'markdown', 'json'

/**
 * Set the output format for clipboard data
 * @param {string} format - One of: 'tsv', 'csv', 'markdown', 'json'
 */
function setOutputFormat(format) {
  if (['tsv', 'csv', 'markdown', 'json'].includes(format)) {
    outputFormat = format;
  }
}

/**
 * Format the table structure based on current output format preference
 */
function formatTableOutput(structure, elementMeta) {
  switch (outputFormat) {
    case 'csv':
      return formatAsCSV(structure);
    case 'markdown':
      return formatAsMarkdown(structure);
    case 'json':
      return formatAsJSON(structure, elementMeta);
    case 'tsv':
    default:
      return formatAsTSV(structure);
  }
}

// When the selected element is clicked, extract data, copy it, animate, and show a popup.
function onClickHandler(e) {
  e.preventDefault();
  e.stopPropagation();
  if (selectedElement) {
    // Analyze the element using the new HTML-aware system
    const tableStructure = analyzeTableElement(selectedElement);
    
    // Element metadata for JSON output
    const elementMeta = {
      tag: selectedElement.tagName,
      id: selectedElement.id,
      class: selectedElement.className,
      sourceType: tableStructure.sourceType
    };
    
    // Format output based on preference (default: TSV for spreadsheet compatibility)
    const output = formatTableOutput(tableStructure, elementMeta);
    
    copyToClipboard(output);
    animateRemoval(selectedElement);
    
    // Remove listeners and clear selection.
    selectedElement.removeEventListener("wheel", onWheelHandler);
    selectedElement.removeEventListener("mouseleave", onMouseLeaveHandler);
    selectedElement.removeEventListener("click", onClickHandler);
    selectedElement = null;
    
    // Show format in popup message
    const formatLabel = outputFormat.toUpperCase();
    const rowCount = tableStructure.dataRows.length;
    const colCount = tableStructure.columnCount;
    showPopupMessage(`Clipped as ${formatLabel} (${rowCount} rows × ${colCount} cols)`);
  }
}

// Copies text to the clipboard.
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    console.log("Copied to clipboard");
  }).catch(() => {
    console.error("Copy failed");
  });
}

// Animates the removal of the highlight with an expanding glow effect.
function animateRemoval(el) {
  el.style.transition = "box-shadow 0.5s ease-out, outline 0.5s ease-out";
  el.style.boxShadow = "0 0 20px 10px yellow";
  setTimeout(() => {
    el.style.outline = "";
    el.style.boxShadow = "";
  }, 500);
}

// Shows a temporary popup message.
function showPopupMessage(message) {
  const popup = document.createElement("div");
  popup.textContent = message;
  popup.style.position = "fixed";
  popup.style.top = "20px";
  popup.style.left = "50%";
  popup.style.transform = "translateX(-50%)";
  popup.style.backgroundColor = "black";
  popup.style.color = "white";
  popup.style.padding = "10px";
  popup.style.borderRadius = "5px";
  popup.style.zIndex = 10000;
  document.body.appendChild(popup);
  setTimeout(() => {
    popup.style.transition = "opacity 1s";
    popup.style.opacity = "0";
    setTimeout(() => {
      document.body.removeChild(popup);
    }, 1000);
  }, 2000);
}

// ============================================================================
// SIMPLIFY
// Removes inline styles from div/section wrappers and flattens simple structure.
// ============================================================================

function simplifyPageStructure() {
  const stats = {
    scanned: 0,
    stylesRemoved: 0,
    labeledKept: 0,
    removed: 0,
    flattened: 0
  };
  const labeledElements = new Set();

  Array.from(document.body.querySelectorAll("div, section")).forEach(element => {
    if (isTaskimaticOwnedElement(element)) return;
    stats.scanned++;

    if (element.hasAttribute("style")) {
      element.removeAttribute("style");
      stats.stylesRemoved++;
    }

    if (element.hasAttribute("aria-labelledby")) {
      const preservedElement = preserveLabeledContainer(element);
      labeledElements.add(preservedElement);
      stats.labeledKept++;
    }
  });

  let changed = true;
  let passes = 0;
  while (changed && passes < 40) {
    changed = false;
    passes++;

    const elements = Array.from(document.body.querySelectorAll("div, section")).reverse();
    elements.forEach(element => {
      if (!element.parentNode || isTaskimaticOwnedElement(element) || labeledElements.has(element)) {
        return;
      }

      if (isEmptySimplifyNode(element)) {
        element.remove();
        stats.removed++;
        changed = true;
        return;
      }

      const onlyChild = getOnlyMeaningfulChildElement(element);
      if (onlyChild) {
        element.parentNode.replaceChild(onlyChild, element);
        stats.flattened++;
        changed = true;
      }
    });
  }

  showPopupMessage(`Simplified page: ${stats.flattened} flattened, ${stats.removed} removed`);
  return stats;
}

function preserveLabeledContainer(element) {
  const labelText = getAriaLabelledByText(element);
  const container = element.tagName === "DIV" ? element : convertElementToDiv(element);

  if (labelText && !hasExistingSimplifyHeading(container, labelText)) {
    const heading = document.createElement("h3");
    heading.textContent = labelText;
    heading.setAttribute("data-taskimatic-simplify-heading", "true");
    container.insertBefore(heading, container.firstChild);
  }

  return container;
}

function convertElementToDiv(element) {
  const replacement = document.createElement("div");

  Array.from(element.attributes).forEach(attribute => {
    if (attribute.name !== "style") {
      replacement.setAttribute(attribute.name, attribute.value);
    }
  });

  while (element.firstChild) {
    replacement.appendChild(element.firstChild);
  }

  element.parentNode.replaceChild(replacement, element);
  return replacement;
}

function getAriaLabelledByText(element) {
  return (element.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .map(id => id && document.getElementById(id))
    .filter(Boolean)
    .map(label => (label.innerText || label.textContent || "").trim())
    .filter(Boolean)
    .join(" ");
}

function hasExistingSimplifyHeading(container, labelText) {
  const firstElement = container.firstElementChild;
  return Boolean(firstElement) &&
    /^H[1-6]$/.test(firstElement.tagName) &&
    (firstElement.innerText || firstElement.textContent || "").trim() === labelText;
}

function isEmptySimplifyNode(element) {
  if (element.children.length > 0) return false;
  return !(element.textContent || "").trim();
}

function getOnlyMeaningfulChildElement(element) {
  if (element.children.length !== 1) return null;

  const hasMeaningfulText = Array.from(element.childNodes).some(node => {
    return node.nodeType === Node.TEXT_NODE && node.nodeValue.trim();
  });

  return hasMeaningfulText ? null : element.children[0];
}

function isTaskimaticOwnedElement(element) {
  return Boolean(element.closest([
    "#custom-overlay",
    "#domainOverlay",
    "#highlight-overlay",
    "#modal-overlay",
    "[data-taskimatic-quick-read='word']",
    "[data-taskimatic-simplify-heading='true']"
  ].join(",")));
}

// ============================================================================
// QUICK READ
// Finds likely prose-heavy content containers and adjusts word styling.
// ============================================================================

function applyQuickReadFormatting(message = {}) {
  ensureQuickReadStyles();
  clearQuickReadFormatting();

  const commonWords = new Set(QUICK_READ_COMMON_WORDS);
  const interrogativeWords = new Set(QUICK_READ_INTERROGATIVE_WORDS);
  const actionWords = new Set(normalizeQuickReadWordList(
    message.actionWords,
    QUICK_READ_DEFAULT_ACTION_WORDS
  ));
  const containers = findQuickReadContentContainers();

  if (containers.length === 0) {
    showPopupMessage("No readable content found");
    return { ok: false, error: "No readable content found." };
  }

  let wordCount = 0;
  containers.forEach(container => {
    container.setAttribute("data-taskimatic-quick-read-container", "true");
    wordCount += formatQuickReadTextNodes(container, {
      commonWords,
      interrogativeWords,
      actionWords
    });
  });

  showPopupMessage(`Quick Read formatted ${wordCount} words`);
  return { containers: containers.length, words: wordCount };
}

function normalizeQuickReadWordList(value, fallback = []) {
  const rawWords = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,]+/);
  const seen = new Set();
  const words = rawWords
    .map(word => String(word).trim().toLowerCase())
    .filter(word => /^[a-z]+(?:'[a-z]+)?$/.test(word))
    .filter(word => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });

  return words.length ? words : fallback;
}

function ensureQuickReadStyles() {
  if (document.getElementById("taskimatic-quick-read-styles")) return;

  const style = document.createElement("style");
  style.id = "taskimatic-quick-read-styles";
  style.textContent = `
    .taskimatic-quick-read-word {
      font-size: 1.16em;
      line-height: 1.35;
    }
    .taskimatic-quick-read-common {
      font-size: 0.82em;
      opacity: 0.84;
    }
    .taskimatic-quick-read-interrogative {
      background: #ffe08a;
      color: #3d2b00;
      border-radius: 999px;
      padding: 0.03em 0.34em;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .taskimatic-quick-read-action {
      font-weight: 700;
    }
  `;
  document.documentElement.appendChild(style);
}

function clearQuickReadFormatting() {
  const wrappers = Array.from(document.querySelectorAll('[data-taskimatic-quick-read="word"]'));
  const parents = new Set();

  wrappers.forEach(wrapper => {
    const parent = wrapper.parentNode;
    if (!parent) return;
    parents.add(parent);
    parent.replaceChild(document.createTextNode(wrapper.textContent), wrapper);
  });

  parents.forEach(parent => parent.normalize());

  document
    .querySelectorAll('[data-taskimatic-quick-read-container="true"]')
    .forEach(container => {
      container.removeAttribute("data-taskimatic-quick-read-container");
    });
}

function findQuickReadContentContainers() {
  const elements = Array.from(document.body.querySelectorAll("main, article, section, div"));
  const candidates = elements
    .filter(isQuickReadCandidateElement)
    .map(element => buildQuickReadCandidate(element))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  const filteredCandidates = candidates.filter(candidate => {
    return !candidates.some(other => {
      if (candidate === other || !candidate.element.contains(other.element)) return false;
      return other.wordCount >= candidate.wordCount * 0.65 &&
        other.score >= candidate.score * 0.7 &&
        other.linkDensity <= candidate.linkDensity + 0.1;
    });
  });

  const selected = [];
  filteredCandidates.forEach(candidate => {
    const overlapsSelected = selected.some(existing => {
      return existing.element.contains(candidate.element) ||
        candidate.element.contains(existing.element);
    });

    if (!overlapsSelected && selected.length < 6) {
      selected.push(candidate);
    }
  });

  return selected.map(candidate => candidate.element);
}

function isQuickReadCandidateElement(element) {
  if (!element || element === document.body || element === document.documentElement) {
    return false;
  }
  if (isQuickReadExcludedElement(element)) {
    return false;
  }
  if (!isQuickReadVisible(element)) {
    return false;
  }
  return true;
}

function buildQuickReadCandidate(element) {
  const text = getQuickReadCleanText(element);
  const wordCount = getQuickReadWordCount(text);

  if (wordCount < 45 || text.length < 180) {
    return null;
  }

  const linkLength = Array.from(element.querySelectorAll("a"))
    .reduce((total, link) => total + getQuickReadCleanText(link).length, 0);
  const linkDensity = text.length ? linkLength / text.length : 1;

  if (linkDensity > 0.35) {
    return null;
  }

  const sentenceCount = (text.match(/[.!?](\s|$)/g) || []).length;
  if (sentenceCount < 1 && wordCount < 120) {
    return null;
  }

  const identity = `${element.id || ""} ${element.className || ""}`.toLowerCase();
  const hasLowValueName = /\b(ad|ads|advert|banner|breadcrumb|comment|cookie|footer|header|menu|modal|nav|promo|related|share|sidebar|social|sponsor|subscribe)\b/.test(identity);
  const tagBonus = element.tagName === "ARTICLE" ? 90 :
    element.tagName === "MAIN" ? 70 :
    element.tagName === "SECTION" ? 25 : 0;
  const penalty = hasLowValueName ? 120 : 0;
  const score = (wordCount * (1 - linkDensity)) + (sentenceCount * 20) + tagBonus - penalty;

  if (score < 35) {
    return null;
  }

  return {
    element,
    linkDensity,
    score,
    wordCount
  };
}

function getQuickReadCleanText(element) {
  return (element.innerText || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getQuickReadWordCount(text) {
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g);
  return words ? words.length : 0;
}

function isQuickReadVisible(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

function isQuickReadExcludedElement(element) {
  if (QUICK_READ_EXCLUDED_TAGS.has(element.tagName)) return true;

  return Boolean(element.closest([
    "aside",
    "footer",
    "header",
    "nav",
    "[aria-hidden='true']",
    "[role='banner']",
    "[role='contentinfo']",
    "[role='navigation']",
    "#custom-overlay",
    "#domainOverlay",
    "#highlight-overlay",
    "#modal-overlay"
  ].join(",")));
}

function formatQuickReadTextNodes(container, wordSets) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent || isQuickReadExcludedTextParent(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        return /[A-Za-z]/.test(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  let wordCount = 0;
  textNodes.forEach(textNode => {
    const fragment = document.createDocumentFragment();
    const tokens = textNode.nodeValue.match(/[A-Za-z]+(?:'[A-Za-z]+)?|\s+|./g) || [];

    tokens.forEach(token => {
      if (/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token)) {
        fragment.appendChild(createQuickReadWord(token, wordSets));
        wordCount++;
      } else {
        fragment.appendChild(document.createTextNode(token));
      }
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  });

  return wordCount;
}

function isQuickReadExcludedTextParent(parent) {
  if (parent.closest('[data-taskimatic-quick-read="word"]')) return true;
  if (QUICK_READ_EXCLUDED_TAGS.has(parent.tagName)) return true;

  return Boolean(parent.closest([
    "a",
    "button",
    "code",
    "pre",
    "select",
    "textarea",
    "#custom-overlay",
    "#domainOverlay",
    "#highlight-overlay",
    "#modal-overlay"
  ].join(",")));
}

function createQuickReadWord(word, { commonWords, interrogativeWords, actionWords }) {
  const normalizedWord = word.toLowerCase();
  const span = document.createElement("span");
  span.setAttribute("data-taskimatic-quick-read", "word");
  span.textContent = word;
  span.className = "taskimatic-quick-read-word";

  if (commonWords.has(normalizedWord)) {
    span.classList.add("taskimatic-quick-read-common");
  }
  if (interrogativeWords.has(normalizedWord)) {
    span.classList.add("taskimatic-quick-read-interrogative");
  }
  if (actionWords.has(normalizedWord)) {
    span.classList.add("taskimatic-quick-read-action");
  }

  return span;
}


// Create the overlay window when the page loads.
(function createOverlayWindow() {
    if (window !== window.top) return;
    if (document.getElementById("domainOverlay")) return;
  
    const overlay = document.createElement("div");
    overlay.id = "domainOverlay";
    overlay.style.position = "fixed";
    overlay.style.bottom = "10px";
    overlay.style.right = "10px";
    overlay.style.width = "200px";
    overlay.style.maxHeight = "150px";
    overlay.style.overflow = "auto";
    overlay.style.background = "rgba(0, 0, 0, 0.7)";
    overlay.style.color = "white";
    overlay.style.padding = "10px";
    overlay.style.borderRadius = "5px";
    overlay.style.fontSize = "12px";
    overlay.style.transition = "width 0.3s, height 0.3s";
    overlay.style.cursor = "pointer";
    overlay.style.zIndex = "10000"; // Ensure it sits on top
  
    // Create close button
    const closeButton = document.createElement("div");
    closeButton.id = "domainOverlayClose";
    closeButton.textContent = "X";
    closeButton.style.position = "absolute";
    closeButton.style.top = "2px";
    closeButton.style.right = "5px";
    closeButton.style.cursor = "pointer";
    closeButton.style.fontWeight = "bold";
    closeButton.style.padding = "2px";
  
    // Change background on hover
    closeButton.addEventListener("mouseover", () => {
      closeButton.style.background = "red";
    });
    closeButton.addEventListener("mouseout", () => {
      closeButton.style.background = "transparent";
    });
    // Hide overlay when close button is clicked.
    closeButton.addEventListener("click", (e) => {
      e.stopPropagation();
      overlay.style.display = "none";
    });
  
    overlay.appendChild(closeButton);
  
    // Container for domain count text.
    const contentDiv = document.createElement("div");
    contentDiv.id = "domainOverlayContent";
    contentDiv.style.marginTop = "20px";
    overlay.appendChild(contentDiv);
  
    // Expand overlay on click (from bottom-right to auto size)
    overlay.addEventListener("click", () => {
      overlay.style.width = "auto";
      overlay.style.height = "auto";
    });
  
    document.body.appendChild(overlay);
})();

function scanForHighTextElements() {
  // Get all elements under <body>
  const allElements = Array.from(document.body.querySelectorAll("*"));
  
  // Create an array of candidates that have a lot of text.
  // You can adjust the threshold as needed.
  const THRESHOLD = 100; // characters
  let candidates = allElements.filter(el => {
    // Exclude script/style and hidden elements.
    if (["SCRIPT", "STYLE"].includes(el.tagName)) return false;
    if (!el.offsetParent) return false;
    const txt = el.innerText || "";
    return txt.trim().length >= THRESHOLD;
  });
  
  // Sort candidates descending by text length.
  candidates.sort((a,b) => (b.innerText.length - a.innerText.length));
  
  // Build an array of pairs { headerText, contentText }.
  const headerContentPairs = [];
  
  // To avoid duplicates, keep track of candidate elements processed.
  const seen = new WeakSet();
  
  candidates.forEach(candidate => {
    if (seen.has(candidate)) return;
    
    // Look upward: check the candidate’s parent’s previousElementSibling
    const parent = candidate.parentElement;
    if (parent && parent.previousElementSibling) {
      const potentialHeader = parent.previousElementSibling;
      if (/^H[1-6]$/.test(potentialHeader.tagName)) {
        headerContentPairs.push({
          headerText: potentialHeader.innerText.trim(),
          contentText: candidate.innerText.trim()
        });
        seen.add(candidate);
      }
    }
  });
  
  if (headerContentPairs.length) {
    showModalWithPairs(headerContentPairs);
  }
}

function showModalWithPairs(pairs) {
  // Create overlay
  const modalOverlay = document.createElement("div");
  modalOverlay.id = "modal-overlay";
  modalOverlay.style.position = "fixed";
  modalOverlay.style.top = "0";
  modalOverlay.style.left = "0";
  modalOverlay.style.width = "100%";
  modalOverlay.style.height = "100%";
  modalOverlay.style.backgroundColor = "rgba(0,0,0,0.5)";
  modalOverlay.style.zIndex = "100000";
  modalOverlay.addEventListener("click", () => {
    document.body.removeChild(modalOverlay);
  });

  // Create modal container
  const modal = document.createElement("div");
  modal.id = "modal-content";
  modal.style.position = "fixed";
  modal.style.top = "10%";
  modal.style.left = "50%";
  modal.style.transform = "translateX(-50%)";
  modal.style.backgroundColor = "#fff";
  modal.style.padding = "20px";
  modal.style.width = "80%";
  modal.style.maxHeight = "80%";
  modal.style.overflowY = "auto";
  modal.style.borderRadius = "4px";
  modal.style.boxShadow = "0 2px 10px rgba(0,0,0,0.3)";
  modal.style.zIndex = "100001";
  
  // Create close button
  const closeButton = document.createElement("span");
  closeButton.textContent = "X";
  closeButton.style.float = "right";
  closeButton.style.cursor = "pointer";
  closeButton.style.fontWeight = "bold";
  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    document.body.removeChild(modalOverlay);
  });
  modal.appendChild(closeButton);
  
  // Create title
  const title = document.createElement("h2");
  title.textContent = "High Text Element Pairs";
  title.style.clear = "both";
  modal.appendChild(title);
  
  // Create list of header-content pairs.
  const list = document.createElement("ul");
  list.style.listStyle = "none";
  list.style.padding = "0";
  
  pairs.forEach(pair => {
    const li = document.createElement("li");
    li.style.marginBottom = "10px";
    li.style.borderBottom = "1px solid #ccc";
    li.style.paddingBottom = "5px";
    
    const headerEl = document.createElement("strong");
    headerEl.textContent = pair.headerText || "No Header";
    
    const contentEl = document.createElement("p");
    contentEl.textContent = pair.contentText;
    contentEl.style.margin = "5px 0 0 0";
    
    li.appendChild(headerEl);
    li.appendChild(contentEl);
    list.appendChild(li);
  });
  
  modal.appendChild(list);
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);
}

// --- Data Functions ---
function launchAppWithData(data) {
  const jsonData = encodeURIComponent(JSON.stringify(data));
  // Construct a URL with your custom scheme
  const launchUrl = `myapp://loadData?data=${jsonData}`;
  // Trigger the URL – this may prompt the user to allow the launch
  window.location.href = launchUrl;
}
