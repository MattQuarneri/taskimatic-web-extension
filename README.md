# taskimatic_webext
Helps you Manage and Analyze you Tabs, Bookmarks, History and Get your Data with ease.

## Target store purchases

In the extension popup's **Content** tab, turn on **Process Target data**. On
`https://www.target.com/orders`, select **In-store** and click **Get data** to
capture the currently loaded order cards. Use Target's **Load more purchases**
button and click **Get data** again to add more orders. On each
`/orders/stores/{order id}` page, click **Get data** to add its items, quantities,
prices, and totals. Each capture updates a separate Target JSON window; it also
stays in local extension storage. The Content tab can reopen the window, which
offers copy and download actions. Turning the switch off removes the page
buttons.

After changing the unpacked extension's files, reload it on Chrome's Extensions
page and refresh the Target orders tab so the new content script is injected.
