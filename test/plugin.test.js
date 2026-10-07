const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPlugin } = require("./harness/sandbox");
const { makeHost } = require("./harness/host");
const { VQD, TOKEN_PAGE, hit, page, ARTIST, ALBUM } = require("./fixtures");

// Serve the token page for duckduckgo.com/ and `results` for i.js.
function ddg(results) {
  return (u) => {
    if (u.hostname !== "duckduckgo.com") return undefined;
    if (u.pathname === "/") return TOKEN_PAGE;
    if (u.pathname === "/i.js") return results;
    return undefined;
  };
}

function setup(route) {
  const plugin = loadPlugin();
  const host = makeHost({ route });
  plugin.activate(host.api);
  return { plugin, host };
}

test("registers artist and album image providers and the search tool", () => {
  const { host } = setup(ddg(ARTIST));
  assert.equal(typeof host.imageHandlers.artist, "function");
  assert.equal(typeof host.imageHandlers.album, "function");
  assert.equal(host.imageHandlers.tag, undefined);
  assert.equal(typeof host.tools.search_images, "function");
});

test("gets a token first, then asks i.js with it; every request has a timeout and stays on duckduckgo.com", async () => {
  const { host } = setup(ddg(ARTIST));
  await host.imageHandlers.artist("Portishead");
  assert.equal(host.requests.length, 2);
  const [tokenReq, imagesReq] = host.requests;
  assert.equal(tokenReq.url.pathname, "/");
  assert.equal(tokenReq.url.searchParams.get("iax"), "images");
  assert.equal(imagesReq.url.pathname, "/i.js");
  assert.equal(imagesReq.url.searchParams.get("vqd"), VQD);
  assert.equal(imagesReq.url.searchParams.get("o"), "json");
  for (const r of host.requests) {
    assert.equal(r.url.hostname, "duckduckgo.com");
    assert.equal(typeof r.init.timeoutMs, "number");
    assert.match(r.init.headers["User-Agent"], /Mozilla/);
  }
});

test("artist: skips stock, sleeves, non-mentions, small, gif; prefers https and non-square", async () => {
  const { host } = setup(ddg(ARTIST));
  const out = await host.imageHandlers.artist("Portishead");
  assert.equal(out.status, "ok");
  assert.equal(out.url, "https://wallpapercave.com/wp/wp9440792.jpg");
  // The host downloads with these: a browser UA and the page as referer.
  assert.match(out.headers["User-Agent"], /Mozilla/);
  assert.equal(out.headers.Referer, "https://wallpapercave.com/portishead-wallpapers");
  assert.match(host.requests[1].url.searchParams.get("q"), /Portishead musician/);
});

test("artist: a square image wins only when nothing else is left", async () => {
  const square = hit("https://images.example.org/portishead-square.jpg", { title: "Portishead", width: 2400, height: 2400 });
  const { host } = setup(ddg(page([square])));
  const out = await host.imageHandlers.artist("Portishead");
  assert.equal(out.url, square.image);
});

test("artist: name must be whole words — Bush is not Bushwick", async () => {
  const { host } = setup(ddg(page([hit("https://x.example.com/bushwick.jpg", { title: "Bushwick nights" })])));
  assert.deepEqual(await host.imageHandlers.artist("Bush"), { status: "not_found" });
});

test("artist: no results → not_found; blank name asks nothing", async () => {
  const { host } = setup(ddg(page([])));
  assert.deepEqual(await host.imageHandlers.artist("Portishead"), { status: "not_found" });
  const before = host.requests.length;
  assert.deepEqual(await host.imageHandlers.artist("  "), { status: "not_found" });
  assert.equal(host.requests.length, before);
});

test("album: square layout filter, album title must appear, near-square only", async () => {
  const { host } = setup(ddg(ALBUM));
  const out = await host.imageHandlers.album("Dummy", "Portishead");
  assert.equal(out.status, "ok");
  assert.equal(out.url, "https://e.snmc.io/i/600/portishead-dummy-cover-art.png");
  const req = host.requests[1].url;
  assert.equal(req.searchParams.get("f"), ",,,layout:Square,");
  assert.equal(req.searchParams.get("q"), "Portishead Dummy album cover");
});

test("album: a short title needs the artist named too", async () => {
  const other = hit("https://shop.example.com/third.jpg", { title: "Third — The Soft Machine", width: 1000, height: 1000 });
  const { host } = setup(ddg(page([other])));
  assert.deepEqual(await host.imageHandlers.album("Third", "Portishead"), { status: "not_found" });
});

test("errors become status:error, never a guess", async () => {
  const limited = setup(() => ({ status: 429, body: "slow down" }));
  const out = await limited.host.imageHandlers.artist("Portishead");
  assert.equal(out.status, "error");
  assert.match(out.message, /rate-limiting/);

  const noToken = setup((u) => (u.pathname === "/" ? "<html>nothing here</html>" : page([])));
  const out2 = await noToken.host.imageHandlers.album("Dummy", "Portishead");
  assert.equal(out2.status, "error");
  assert.match(out2.message, /token/);

  const notJson = setup((u) => (u.pathname === "/" ? TOKEN_PAGE : "<html>captcha</html>"));
  const out3 = await notJson.host.imageHandlers.artist("Portishead");
  assert.equal(out3.status, "error");
  assert.match(out3.message, /JSON/);
});

test("parseVqd reads the token in its quoted and URL forms", () => {
  const { plugin } = setup(ddg(ARTIST));
  assert.equal(plugin._parseVqd(`vqd="4-123-456"`), "4-123-456");
  assert.equal(plugin._parseVqd(`vqd='4-99'`), "4-99");
  assert.equal(plugin._parseVqd(`/d.js?q=a&vqd=4-77&p=1`), "4-77");
  assert.equal(plugin._parseVqd(`no token`), null);
});

test("mentions: accents, case, whole words, run-together multi-word names", () => {
  const { plugin } = setup(ddg(ARTIST));
  assert.equal(plugin._mentions("BJORK discography", "Björk"), true);
  assert.equal(plugin._mentions("Bushwick", "Bush"), false);
  assert.equal(plugin._mentions("ACDC live", "AC/DC"), true);
  assert.equal(plugin._mentions("Nick Cave & The Bad Seeds live", "Nick Cave & The Bad Seeds"), true);
  assert.equal(plugin._mentions("Χάρις Αλεξίου", "Χάρις Αλεξίου"), true);
});

test("search_images: filters, limit, thumbnails, echoes the caller's options", async () => {
  const { host } = setup(ddg(ARTIST));
  const out = await host.tools.search_images({ query: "Portishead live", layout: "wide", license: "share", limit: 2, thumbnails: true });
  assert.equal(host.requests[1].url.searchParams.get("f"), ",,,layout:Wide,license:Share");
  assert.equal(out.layout, "wide");
  assert.equal(out.license, "share");
  assert.equal(out.images.length, 2);
  for (const img of out.images) {
    assert.ok(!/alamy/.test(img.url), "stock host left out");
    assert.ok(img.width >= 500);
    assert.ok(img.thumbUrl);
    assert.ok(img.site);
  }
  assert.match(out.note, /licence filter/);
});

test("search_images: validates its arguments", async () => {
  const { host } = setup(ddg(ARTIST));
  await assert.rejects(host.tools.search_images({}), /query is required/);
  await assert.rejects(host.tools.search_images({ query: "x", layout: "round" }), /Unknown layout/);
  await assert.rejects(host.tools.search_images({ query: "x", limit: "lots" }), /expected a number/);
  const out = await host.tools.search_images({ query: "x", limit: 999 });
  assert.ok(out.images.length <= 50);
  assert.equal(out.license, "any");
  assert.equal(out.images[0].thumbUrl, undefined);
});

test("manifest: providers and a read-only tool, network scoped to duckduckgo.com", () => {
  const m = require("../manifest.json");
  assert.equal(m.id, "duckduckgo");
  assert.equal(m.runtime, "worker");
  assert.deepEqual(m.permissions, ["network:duckduckgo.com"]);
  assert.deepEqual(m.contributes.imageProviders.map((p) => p.entity), ["artist", "album"]);
  const tool = m.contributes.assistant.tools.find((t) => t.name === "search_images");
  assert.equal(tool.readOnly, true);
});
