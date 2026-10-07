# CLAUDE.md

Viboplr plugin `duckduckgo` ("DuckDuckGo Images"). Plugin = `index.js` (a function
body returning `{ activate, deactivate, _testHooks… }`) + `manifest.json`. Worker
runtime (`"runtime": "worker"`): no `fetch`, only `api.network.fetch`, and only to
`duckduckgo.com`.

## Rules

- **A fallback provider, so be strict.** A web search only knows which pictures sit
  near the words. Every provider pick must name the entity in its title or page URL
  (`mentions`, whole words), pass the size/shape bounds, and avoid `BLOCKED_HOSTS`
  and (artists) `NOT_AN_ARTIST_PHOTO`. Returning `not_found` is always better than a
  wrong picture: the user's image is cached and they'll have to fix it by hand.
- **Never guess on a broken response.** No token, non-JSON, 403/429 → `status:
  "error"` with a message. The chain moves on.
- **Only duckduckgo.com.** The host downloads the image URL we return (with the
  `headers` we pass). Do not add `network:*` to fetch or verify images ourselves.
- **i.js filter slots are positional:** `size,color,type,layout,license`. Only
  `layout` and `license` take effect (tested 2026-10-07); size is filtered locally.
- `search_images` must stay `readOnly: true` in the manifest.

## Commands

```
npm test        # node --test (test/*.test.js), no dependencies
npm run check   # node --check index.js
node scripts/live.cjs artist "<name>" [--check]   # against the real site; --check downloads the pick
node scripts/live.cjs album "<title>" "<artist>" [--check]
node scripts/live.cjs search '<json args>'
```

`test/harness/sandbox.js` loads `index.js` the way the worker does and shadows
the globals the worker deletes; `test/harness/host.js` is a fake plugin API that
routes `network.fetch` to the fixtures in `test/fixtures.js`.
