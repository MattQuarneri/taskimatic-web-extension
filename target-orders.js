// Manual Target capture. The popup switch controls whether a page button exists;
// no order pages are opened or processed until the user clicks Get data.
(() => {
  if (globalThis.taskimaticTargetCaptureLoaded) return;
  globalThis.taskimaticTargetCaptureLoaded = true;

  const ORDER_PATH = /^\/orders\/?$/;
  const DETAIL_PATH = /^\/orders\/stores\/([0-9-]+)\/?$/;
  let enabled = false;
  let control = null;
  let controlRoot = null;
  let controlType = null;
  let scheduled = false;

  const text = element => element?.textContent?.replace(/\s+/g, " ").trim() || "";
  const money = value => {
    const match = String(value || "").replace(/,/g, "").match(/(-?)\$\s*(\d+(?:\.\d{2})?)/);
    return match ? Number(`${match[1]}${match[2]}`) : null;
  };

  function listOrders() {
    const root = document.querySelector('[data-module-type="OrderHistoryContent"]');
    const found = new Map();
    for (const link of root?.querySelectorAll('a[href*="/orders/stores/"]') || []) {
      const url = new URL(link.getAttribute("href"), location.origin);
      const match = DETAIL_PATH.exec(url.pathname);
      if (!match || url.origin !== location.origin) continue;

      const card = link.closest('[data-test="store-order-details-link"]') || link.parentElement;
      const label = link.getAttribute("aria-label") || "";
      const date = label.match(/from (.+?) at /)?.[1]
        || text(card?.querySelector('p.h-text-bold')) || null;
      const store = label.match(/ at (.+)$/)?.[1]
        || text([...(card?.querySelectorAll("p") || [])]
          .find(item => /^Store trip at /i.test(text(item)))).replace(/^Store trip at /i, "") || null;
      found.set(match[1], {
        id: match[1],
        url: `${location.origin}${url.pathname}`,
        date,
        store: store?.trim() || null,
        listTotal: money(text(card?.querySelector('p.h-text-grayDark')))
      });
    }
    return [...found.values()];
  }

  function extractPurchase() {
    const id = DETAIL_PATH.exec(location.pathname)?.[1];
    const root = document.querySelector('[data-test="store-order-details-v2-container"]');
    const receipt = text(root?.querySelector('[data-test="store-order-details-receipt-id"]'));
    if (!id || !root || !receipt.includes(id)) return null;

    const header = root.querySelector('[data-test="store-order-details-receipt-id"]')?.parentElement;
    const purchased = [...(header?.children || [])]
      .map(text).find(value => /^Purchased on /i.test(value)) || "";
    const locationLabel = [...root.querySelectorAll("p")]
      .find(element => text(element) === "Store Location");
    const items = [...root.querySelectorAll('h3[id^="item-"]')].map(heading => {
      const container = heading.parentElement;
      const priceText = text(container?.querySelector('[data-test="order-price"]'));
      const quantityText = [...(container?.querySelectorAll("p") || [])]
        .map(text).find(value => /^Qty\s*\d+/i.test(value));
      return {
        productId: heading.id.slice(5),
        name: text(heading),
        quantity: Number(quantityText?.match(/^Qty\s*(\d+)/i)?.[1] || 1),
        displayedPrice: money(priceText),
        displayedPriceText: priceText || null,
        priceBasis: /\beach\b/i.test(priceText) ? "each" : "unspecified",
        imageUrl: container?.parentElement?.querySelector("img")?.getAttribute("src") || null
      };
    });
    const value = selector => money(text(root.querySelector(selector)));
    const purchase = {
      id,
      url: location.href,
      purchasedAt: purchased.replace(/^Purchased on\s*/i, "") || null,
      storeLocation: text(locationLabel?.nextElementSibling) || null,
      items,
      subtotal: value('[data-test="sub-total-value"]'),
      discounts: value('[data-test="discount-value"]'),
      tax: value('[data-test="tax-total"]'),
      fulfillment: text(root.querySelector('[data-test="shipping-fee-value"]')) || null,
      total: value('[data-test="grand-total"]'),
      capturedAt: new Date().toISOString()
    };
    return items.length && purchase.total !== null ? purchase : null;
  }

  function removeControl() {
    control?.remove();
    control = null;
    controlRoot = null;
    controlType = null;
  }

  function showStatus(message, isError = false) {
    const status = control?.shadowRoot?.querySelector('[role="status"]');
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(isError);
  }

  async function capturePage() {
    if (!enabled) return;
    const pageType = ORDER_PATH.test(location.pathname) ? "orders" :
      DETAIL_PATH.test(location.pathname) ? "purchase" : null;
    if (!pageType) return;
    if (document.querySelector('#px-captcha-modal, iframe[src*="captcha"]')) {
      showStatus("Complete Target's verification, then try again.", true);
      return;
    }

    let data;
    if (pageType === "orders") {
      const orders = listOrders();
      if (!orders.length) {
        showStatus("Select In-store and wait for purchases to load.", true);
        return;
      }
      data = { orders, capturedAt: new Date().toISOString() };
    } else {
      data = extractPurchase();
      if (!data) {
        showStatus("Purchase details are still loading. Try again shortly.", true);
        return;
      }
    }

    const button = control?.shadowRoot?.querySelector("button");
    if (button) button.disabled = true;
    showStatus("Adding data…");
    try {
      const response = await chrome.runtime.sendMessage({
        action: "appendTargetData",
        pageType,
        data
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save Target data.");
      showStatus(`${response.orderCount} orders, ${response.purchaseCount} purchases in JSON window.`);
    } catch (error) {
      showStatus(error.message || String(error), true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function addControl(root, pageType) {
    const host = document.createElement("div");
    host.setAttribute("data-taskimatic-target-control", "");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; margin: 12px 0; color-scheme: light; }
      .panel { display: flex; align-items: center; gap: 10px; width: fit-content;
        max-width: 100%; padding: 8px 10px; border: 1px solid #c7cdd4;
        border-radius: 8px; background: white; box-shadow: 0 2px 8px #0002;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button { border: 0; border-radius: 5px; padding: 8px 12px;
        background: #cc0000; color: white; font: inherit; font-weight: 600; cursor: pointer; }
      button:disabled { opacity: .55; cursor: wait; }
      [role="status"] { color: #333; }
      [role="status"][data-error="true"] { color: #a00000; }
    `;
    const panel = document.createElement("div");
    panel.className = "panel";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Get data";
    button.addEventListener("click", capturePage);
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    panel.append(button, status);
    shadow.append(style, panel);
    root.prepend(host);
    control = host;
    controlRoot = root;
    controlType = pageType;
  }

  function reconcile() {
    scheduled = false;
    const pageType = ORDER_PATH.test(location.pathname) ? "orders" :
      DETAIL_PATH.test(location.pathname) ? "purchase" : null;
    const root = pageType === "orders"
      ? document.querySelector('[data-module-type="OrderHistoryContent"]')
      : pageType === "purchase"
        ? document.querySelector('[data-test="store-order-details-v2-container"]')
        : null;
    if (!enabled || !root) {
      removeControl();
      return;
    }
    if (control?.isConnected && controlRoot === root && controlType === pageType) return;
    removeControl();
    addControl(root, pageType);
  }

  function scheduleReconcile() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(reconcile, 100);
  }

  chrome.storage.local.get({ processTargetData: false }).then(result => {
    enabled = Boolean(result.processTargetData);
    scheduleReconcile();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.processTargetData) {
      enabled = Boolean(changes.processTargetData.newValue);
      scheduleReconcile();
    }
  });
  new MutationObserver(scheduleReconcile).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  setInterval(scheduleReconcile, 1000); // Target can change routes without a document load.
})();
