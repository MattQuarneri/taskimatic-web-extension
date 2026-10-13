# Plan: Semantic Link Enrichment & Triage

**TL;DR:** Build a shared metadata extractor (canonical URL, Open Graph, JSON-LD, reading time, media/paywall flags), a background fetch pipeline backed by a canonical-URL-keyed store in `chrome.storage.local`, then surface it everywhere: tab triage badges, bookmark/history enrichment with dedup, and a new searchable "Saved" tab.

## Goals

- Finding links later (search/filter saved links by topic, site, type, date)
- Tab triage (decide which open tabs to close, keep, or read first)
- Auto-organization (rule-based grouping, no manual filing)
- Deduplication (collapse the same page saved with different tracking-parameter URLs)

## Metadata schema (normalized)

```
{ url, canonicalUrl, title, description, image, siteName, favicon, ogType,
  author, publishedTime, modifiedTime, section, tags[], lang,
  schemaTypes[] (from JSON-LD @type), wordCount, readingTimeMin,
  isPaywalled, hasVideo, hasAudio, statusCode, fetchedAt,
  sources[] (tab|bookmark|history|saved) }
```

## Steps

### Phase 1 — Foundation: extractor + store + pipeline

1. Create `metadata.js` — a shared `extractMetadata(input, url)` that works on a live `Document` (content script) or an HTML string (background). Returns: `canonicalUrl`, `title`, `description`, `image`, `siteName`, `favicon`, `ogType`, `author`, `publishedTime`, `modifiedTime`, `section`, `tags`, `lang`, `schemaTypes`, `wordCount`/`readingTimeMin`, `isPaywalled`, `hasVideo`/`hasAudio`, `statusCode`, `fetchedAt`.
2. Create `link-store.js` — `chrome.storage.local` CRUD keyed by normalized canonical URL; normalization strips `utm_*`, `fbclid`, `gclid` etc. This is the dedup mechanism.
3. `background.js` — import both modules; add `enrichUrl`/`enrichBatch` message handlers: fetch → parse → store, with a concurrency-limited queue (~4) and a 7-day cache.
4. `content.js` — add an `extractMetadata` case to the existing message handler, using the live DOM (best source for word count, media elements, first-paragraph fallback).

### Phase 2 — Tab triage UI (depends on Phase 1)

5. `view.html` + `actions.js` — "Analyze Tabs" button; enrich open tabs via content scripts; render type/site/reading-time badges; sort by reading time; highlight canonical duplicates.

### Phase 3 — Bookmarks & history (depends on Phase 1)

6. Links tab — "Enrich Bookmarks" batch action via background fetch; dedupe report showing collapsed duplicates.
7. History tab — enrich loaded items, group by `siteName`/`ogType`.

### Phase 4 — Saved-links store + auto-organization (depends on Phase 1)

8. New "Saved" tab in `view.html` — save current/all tabs; search + filter by type/site/date; rule-based auto-grouping (`siteName` → `ogType` → `section`); JSON export like the existing tabs export.

## Relevant files

- `manifest.json` — add `metadata.js` before `content.js` in the content script list; **no new permissions needed** (`<all_urls>`, `webRequest`, `storage` already declared)
- `background.js` — `importScripts`, enrich pipeline alongside existing webRequest tracking (L6–45) and context menus (L47–171)
- `content.js` — one new message case in the handler at L574–631
- `actions.js` / `view.html` — UI wiring, following the existing `tab-widget` pattern
- New: `metadata.js`, `link-store.js`

## Verification

1. Fixture HTML pages (OG-complete, JSON-LD article, bare page, canonical+utm duplicates) → run extractor → assert fields.
2. Enrich a real bookmark folder; confirm utm-variant URLs collapse to one entry.
3. `chrome.storage.local.getBytesInUse` sanity check; verify cache prevents refetch.
4. Manual pass: tab sorting, saved-view filters, dedupe report.

## Decisions

- Storage: `chrome.storage.local`, not `sync` — sync's 8KB/item quota won't fit enriched records.
- MV3 service workers have no `DOMParser` → the background parser will be a targeted `<head>` string parser (metadata is almost entirely in `<head>` anyway). Fallback: an offscreen document if that proves fragile.
- Auto-organization is rule-based (no ML) for v1.
- Extraction method: background fetch from the service worker for non-open pages (bookmarks/history); live DOM extraction for open tabs.

## Further considerations

1. Enriching bookmarks/history fires network requests at every saved URL — keep it behind an explicit "Enrich" button rather than automatic.
2. If summaries (rather than raw descriptions) are wanted later, the "Agent" placeholder tab is a natural home for that.
