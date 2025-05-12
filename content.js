// content.js

let baseElement = null;
let branchRoot = null;
let lastRightClickedElement = null;
let selectedElement = null;

/**
 * Parses text from a data table into a structured object
 * @param {string} text - The raw table text
 * @return {Object} A structured table object
 */
function parseTableText(text) {
  // Create main table object
  const table = { children: [] };
  
  // Split text by newlines to create rows
  const lines = text.split('\n');
  
  // Build the initial structure
  for (const line of lines) {
    if (line.trim() === '') continue; // Skip empty lines
    
    const row = { type: 'row', children: [] };
    
    // Split row by tabs to create fields
    const fields = line.split('\t');
    for (const field of fields) {
      row.children.push({
        type: 'field',
        value: field
      });
    }
    
    // Only add non-empty rows
    if (row.children.length > 0) {
      table.children.push(row);
    }
  }
  
  // Process sequences of rows with the same number of fields
  let currentFieldCount = -1;
  let sequenceStart = 0;
  
  for (let i = 0; i <= table.children.length; i++) {
    const isEndOfTable = i === table.children.length;
    const fieldCount = !isEndOfTable ? table.children[i].children.length : null;
    const isNewSequence = fieldCount !== currentFieldCount;
    
    // If we're at the end of a sequence or the end of the table
    if (isEndOfTable || isNewSequence) {
      // Check if the previous sequence had multiple rows
      const sequenceLength = i - sequenceStart;
      if (sequenceLength > 1) {
        // Get the first row of the sequence and its fields
        const firstRow = table.children[sequenceStart];
        const headerFields = firstRow.children;
        
        // Replace the fields with a single header object
        firstRow.children = [{
          type: 'header',
          children: headerFields
        }];
      }
      
      // Start a new sequence if not at the end
      if (!isEndOfTable) {
        currentFieldCount = fieldCount;
        sequenceStart = i;
      }
    }
  }
  
  return table;
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

// When the selected element is clicked, extract data, copy it, animate, and show a popup.
function onClickHandler(e) {
  e.preventDefault();
  e.stopPropagation();
  if (selectedElement) {
    const data = {
      tag: selectedElement.tagName,
      id: selectedElement.id,
      class: selectedElement.className,
      text: selectedElement.innerText,
      object: parseTableText(selectedElement.innerText)
      //html: selectedElement.outerHTML -- commented out to avoid large data
    };
    copyToClipboard(JSON.stringify(data, null, 2));
    animateRemoval(selectedElement);
    // Remove listeners and clear selection.
    selectedElement.removeEventListener("wheel", onWheelHandler);
    selectedElement.removeEventListener("mouseleave", onMouseLeaveHandler);
    selectedElement.removeEventListener("click", onClickHandler);
    selectedElement = null;
    showPopupMessage("Clipped");
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