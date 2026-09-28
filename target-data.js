const TARGET_DATA_KEY = "targetCapturedData";
let currentJson = "";

const BTN_ID = 'tm-download-orders';

function injectDownloadButton() {
  if (document.getElementById(BTN_ID)) return;
  const filterBtn = document.querySelector('button[aria-label^="Filters menu"]');
  const li = filterBtn?.closest('li');
  if (!li) return;

  const newLi = li.cloneNode(false);        // copies the carousel item's classes, no children
  newLi.removeAttribute('data-io-i');       // don't join the carousel's visibility tracking
  newLi.removeAttribute('data-io-v');

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.className = filterBtn.className;      // match Target's current styles
  btn.textContent = 'Download Orders';
  btn.setAttribute('aria-label', 'Download orders as JSON');
  btn.addEventListener('click', e => {
    e.stopPropagation();                    // keep the carousel from reacting to the click
    const n = downloadOrders('purchases.json');
    btn.textContent = `Downloaded ${n}`;
    setTimeout(() => (btn.textContent = 'Download Orders'), 2000);
  });

  newLi.appendChild(btn);
  li.after(newLi);
}

// React re-renders this carousel on filter/tab changes and wipes foreign nodes, so re-inject.
new MutationObserver(injectDownloadButton).observe(document.body, { childList: true, subtree: true });
injectDownloadButton();

const decode = s => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
const orders = new Map();

function getOrders() {
  return document.querySelectorAll('div[data-test="store-order-details-link"]');
}

function scan(orders) {
  for (const card of orders) {
    const href = card.querySelector('a[href^="/orders/"]')?.getAttribute('href');
    if (!href || orders.has(href)) continue;
    const t = card.innerText.replace(/\s+/g, ' ');
    orders.set(href, {
      href: new URL(href, location.origin).href,
      date:  t.match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)?.[0] ?? null,
      total: t.match(/\$[\d,]+\.\d{2}/)?.[0] ?? null,
      store: t.match(/Store trip at (.+?)(?: \+\d+)?$/)?.[1]?.trim() ?? null,
      items: [...card.querySelectorAll('img[alt]')].map(i => decode(i.alt)).filter(Boolean)
    });
  }
}

new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
scan(getOrders());

const exportOrders = () => JSON.stringify([...orders.values()], null, 2);

function downloadOrders(orders, filename = 'purchases.json') {
  scan(orders); // pick up anything rendered since the last mutation
  const url = URL.createObjectURL(new Blob([exportOrders()], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return orders.size;
}

async function renderTargetData() {
  const data = (await chrome.storage.local.get(TARGET_DATA_KEY))[TARGET_DATA_KEY] || {};
  const orders = Object.values(data.orders || {});
  const purchases = Object.values(data.purchases || {});
  currentJson = JSON.stringify({
    updatedAt: data.updatedAt || null,
    orders,
    purchases
  }, null, 2);
  document.getElementById("json").textContent = currentJson;
  document.getElementById("summary").textContent =
    `${orders.length} order summaries · ${purchases.length} purchase details`;
}

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

document.addEventListener("DOMContentLoaded", () => {
  void renderTargetData();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[TARGET_DATA_KEY]) void renderTargetData();
  });

  document.getElementById("copyJson").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentJson);
      setStatus("Copied.");
    } catch {
      setStatus("Could not copy JSON.");
    }
  });

  document.getElementById("downloadJson").addEventListener("click", () => {
    const blob = new Blob([currentJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `target-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Downloaded.");
  });
});
