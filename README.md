# DuckDuckGo Images for Viboplr

Artist photos and album covers from [DuckDuckGo](https://duckduckgo.com) image search, for the
artists and albums the music catalogs don't have.

- **Artist and album image provider.** Adds a DuckDuckGo entry to Settings → Providers for artist
  and album images. It's a web search, not a catalog, so **keep it last**: it fills in the local
  band, the bootleg or the obscure reissue after Deezer, iTunes and the rest come up empty.
- **An assistant tool.** `search_images` (MCP: `duckduckgo__search_images`) searches web images by
  free text, with optional shape (`square` / `wide` / `tall`) and usage-rights filters. It is
  read-only, so it works without turning on Settings → AI control → Plugin actions.

## How it picks an image

- **Artists:** searches `<name> musician` and takes the first result that names the artist in its
  title or page URL (whole words, ignoring case and accents, so "Bush" doesn't match "Bushwick"),
  is at least 600px wide and has a normal photo shape. Results that look like sleeves, merch, logos
  or discography pages are skipped, and a square image (often a cover) is used only when nothing
  else qualifies.
- **Albums:** searches `<artist> <album> album cover` with DuckDuckGo's square-layout filter and
  takes the first near-square result of at least 500px that names the album. Results that also name
  the artist come first, and for a short title ("Third") naming the artist is required.
- Stock-photo libraries (watermarked previews) and social-media CDNs (crops, expiring links) are
  always left out. https images are preferred over plain http.

## Limits

- DuckDuckGo has no official API. The plugin uses the same two requests its own image page makes (a
  search token, then the results), so a change on their side can break it. When that happens the
  provider reports an error and the app moves on to the next provider; it never guesses.
- The app downloads the chosen image straight from the site that hosts it. Some sites refuse
  hotlinking even with a browser user agent and referer; then this provider fails for that entity
  and the next one in the list is tried.
- Results are whatever pictures sit near the words on the web. Rights are unknown unless the tool's
  `license` filter is used, and that filter is Bing's own judgement.
- Tags have no provider; genre images from a web search are too generic to be useful.

## Permissions

Worker plugin. It asks for `network:duckduckgo.com` and nothing else. The image files themselves
are downloaded by the app, the same way it downloads any provider's image.

## Development

```
npm test                                              # node --test, no dependencies
npm run check                                         # node --check index.js
node scripts/live.cjs artist "Portishead" --check     # provider pick + download it, real network
node scripts/live.cjs album "Dummy" "Portishead" --check
node scripts/live.cjs search '{"query":"Portishead live","license":"share","limit":5}'
```

Release: bump `version` in `manifest.json`, add a `CHANGELOG.md` entry, then
`git tag vX.Y.Z && git push origin vX.Y.Z`. The Release workflow builds `duckduckgo.zip` and
`update.json` and publishes them; never run `gh release create` by hand.
