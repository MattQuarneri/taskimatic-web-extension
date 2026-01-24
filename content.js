// content.js

let baseElement = null;
let branchRoot = null;
let lastRightClickedElement = null;
let selectedElement = null;

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
});

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
  if (message.action === "activateGetData" && lastRightClickedElement) {
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
  overlay.id = "highlight-overlay";
  overlay.style.position = "absolute";
  overlay.style.top = rect.top + window.scrollY + "px";
  overlay.style.left = rect.left + window.scrollX + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
  overlay.style.border = "2px solid red";
  overlay.style.pointerEvents = "none";  // Make sure it doesn't block clicks.
  overlay.style.zIndex = "9999";
  
  document.body.appendChild(overlay);
}

function removeHighlightOverlay() {
  const existing = document.getElementById("highlight-overlay");
  if (existing) {
    existing.parentNode.removeChild(existing);
  }
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


// Create the overlay window when the page loads.
(function createOverlayWindow() {
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