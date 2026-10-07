// viboplr-duckduckgo — artist and album images from DuckDuckGo image search.
//
// Design notes:
//  - A LAST RESORT, NOT A CATALOG. Deezer, iTunes and the like know which
//    picture belongs to which artist; a web image search only knows which
//    pictures sit near the words. So the provider is strict about what it
//    accepts (the name must be in the result's title, sane size and shape, no
//    stock-photo watermarks) and is meant to sit low in Settings → Providers.
//  - TWO REQUESTS PER SEARCH. DuckDuckGo's image endpoint (i.js) wants a `vqd`
//    token, which only its HTML search page hands out. There is no official
//    API, so both shapes are parsed defensively and any surprise is an error
//    the chain walks past, never a guessed image.
//  - THE APP DOWNLOADS THE IMAGE, NOT US. A provider returns the URL; the host
//    fetches it (with the headers we pass) and falls through to the next
//    provider if that site refuses. Hence only duckduckgo.com in permissions.
//  - WORKER RUNTIME. No fetch, only api.network.fetch.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var SEARCH_PAGE = "https://duckduckgo.com/";
var IMAGES_API = "https://duckduckgo.com/i.js";
// DuckDuckGo serves the token page only to something that looks like a browser.
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
var TIMEOUT_MS = 15000;
var LOCALE = "us-en";
var DEFAULT_LIMIT = 20;
var MAX_LIMIT = 50;
var DEFAULT_MIN_WIDTH = 500;
var ARTIST_MIN_WIDTH = 600;
var ALBUM_MIN_WIDTH = 500;
var TITLE_CAP = 160;
// i.js filter slots are positional: size, color, type, layout, license. Only
// layout and license are honoured (size/type were ignored when tested,
// 2026-10-07), so sizes are filtered here instead.
var LAYOUTS = { square: "Square", wide: "Wide", tall: "Tall" };
var LICENSES = {
  public: "Public",
  share: "Share",
  share_commercially: "ShareCommercially",
  modify: "Modify",
  modify_commercially: "ModifyCommercially",
};
var IMAGE_FORMATS = ["jpeg", "jpg", "png", "webp"];
// Stock libraries watermark their previews; social hosts hand out crops and
// expiring links. Matched against the image URL's host.
var BLOCKED_HOSTS = /(^|\.)(alamy|shutterstock|gettyimages|istockphoto|dreamstime|depositphotos|123rf|bigstockphoto|stock\.adobe|pinimg|pinterest|fbsbx|fbcdn|cdninstagram|tiktokcdn|lookaside\.fbsbx)\./i;
// An artist photo search is full of their record sleeves, merch and logos.
// Matched against the result's title and the image URL.
var NOT_AN_ARTIST_PHOTO = /\b(album|albums|cover|covers|coverart|artwork|vinyl|lp|cd|discography|tracklist|sleeve|merch|shirt|poster|logo|lyrics)\b/i;

var api = null;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
// Same normalization the host backend uses for names: NFD, drop combining
// marks, lowercase, keep only letters/numbers of any script.
function normName(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Words, normalized the same way, for "is this name in that title" checks.
function normWords(s) {
  if (!s) return [];
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Whether `name` appears in `text` as a run of whole words, so "Bush" matches
// "Bush - laut.de" but not "Bushwick". Names that are all punctuation fall
// back to a plain substring test on the normalized strings.
function mentions(text, name) {
  var want = normWords(name);
  if (want.length === 0) {
    var n = normName(name);
    return !!n && normName(text).indexOf(n) !== -1;
  }
  var have = normWords(text);
  for (var i = 0; i + want.length <= have.length; i++) {
    var ok = true;
    for (var j = 0; j < want.length && ok; j++) ok = have[i + j] === want[j];
    if (ok) return true;
  }
  // "AC/DC" → "ac dc" vs a title's "ACDC": a multi-word name may also
  // appear run together.
  return want.length > 1 && normWords(text).indexOf(normName(name)) !== -1;
}

function capText(text, max) {
  if (!text || text.length <= max) return text;
  var cut = text.slice(0, max);
  var space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.|-]+$/, "") + "…";
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------
function query(base, params) {
  var parts = [];
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    var v = params[keys[i]];
    if (v === undefined || v === null) continue;
    parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(String(v)));
  }
  return base + "?" + parts.join("&");
}

async function get(url, accept) {
  var resp = await api.network.fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": accept, "Referer": SEARCH_PAGE },
    timeoutMs: TIMEOUT_MS,
  });
  if (resp.status === 429 || resp.status === 418) {
    throw new Error("DuckDuckGo is rate-limiting requests — try again in a minute");
  }
  if (resp.status === 403) throw new Error("DuckDuckGo refused the request (HTTP 403)");
  if (resp.status < 200 || resp.status >= 300) throw new Error("DuckDuckGo answered HTTP " + resp.status);
  return resp;
}

// The token sits in the page as vqd="4-123…" (or vqd='…', or vqd=4-123… in a
// URL); accept any of them.
function parseVqd(html) {
  var m = /vqd\s*[=:]\s*["']?(\d+-[\d-]+)["']?/.exec(String(html || ""));
  return m ? m[1] : null;
}

async function getVqd(q) {
  var resp = await get(query(SEARCH_PAGE, { q: q, iax: "images", ia: "images" }), "text/html");
  var vqd = parseVqd(await resp.text());
  if (!vqd) throw new Error("DuckDuckGo did not return a search token (its page may have changed)");
  return vqd;
}

function filterParam(opts) {
  var layout = opts.layout ? "layout:" + opts.layout : "";
  var license = opts.license ? "license:" + opts.license : "";
  return ["", "", "", layout, license].join(",");
}

// One page of raw results (DuckDuckGo returns ~100 per page).
async function searchRaw(q, opts) {
  opts = opts || {};
  var vqd = await getVqd(q);
  var resp = await get(query(IMAGES_API, {
    l: LOCALE,
    o: "json",
    q: q,
    vqd: vqd,
    f: filterParam(opts),
    p: "1", // safe search on (moderate)
  }), "application/json");
  var text = await resp.text();
  var data;
  try {
    data = JSON.parse(text);
  } catch (_e) {
    throw new Error("DuckDuckGo returned something other than JSON (its API may have changed)");
  }
  return Array.isArray(data && data.results) ? data.results : [];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
// A raw i.js result → our image shape, or null when it isn't usable at all.
function toImage(r) {
  if (!r || typeof r.image !== "string") return null;
  var host = hostOf(r.image);
  if (!host || !/^https?:$/.test(new URL(r.image).protocol)) return null;
  var fmt = String(r.encoding_format || "").toLowerCase();
  if (fmt && IMAGE_FORMATS.indexOf(fmt) === -1) return null;
  if (!fmt && /\.(gif|svg|ico|bmp)(\?|#|$)/i.test(r.image)) return null;
  var width = Number(r.width) || 0;
  var height = Number(r.height) || 0;
  return {
    url: r.image,
    thumbUrl: typeof r.thumbnail === "string" ? r.thumbnail : undefined,
    width: width || undefined,
    height: height || undefined,
    title: capText(String(r.title || "").replace(/\s+/g, " ").trim(), TITLE_CAP) || undefined,
    pageUrl: typeof r.url === "string" ? r.url : undefined,
    site: hostOf(r.url) || host,
    host: host,
  };
}

function aspect(img) {
  return img.width && img.height ? img.width / img.height : null;
}

// Filters shared by the provider and the tool. `o`: { minWidth, minAspect,
// maxAspect, mention: [names that must all appear in the title or page URL],
// reject: a regex neither the title nor the image URL may match }.
function accept(img, o) {
  if (!img) return false;
  if (BLOCKED_HOSTS.test(img.host)) return false;
  if (o.reject && (o.reject.test(img.title || "") || o.reject.test(urlWords(img.url)))) return false;
  if (o.minWidth && !(img.width >= o.minWidth)) return false;
  var a = aspect(img);
  if (o.minAspect && !(a && a >= o.minAspect)) return false;
  if (o.maxAspect && !(a && a <= o.maxAspect)) return false;
  if (o.mention) {
    var where = (img.title || "") + " " + decodeSafe(img.pageUrl || "");
    for (var i = 0; i < o.mention.length; i++) if (!mentions(where, o.mention[i])) return false;
  }
  return true;
}

// "…/discography_covers/6072/cover_93.jpg" → "… discography covers 6072 cover 93 jpg",
// so \b-anchored word filters see the words in a path.
function urlWords(url) {
  return decodeSafe(url).replace(/[_\-/.?=&+]+/g, " ");
}

function decodeSafe(url) {
  try {
    return decodeURIComponent(url);
  } catch (_e) {
    return url;
  }
}

function pick(raw, o) {
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var img = toImage(raw[i]);
    if (!accept(img, o) || seen[img.url]) continue;
    seen[img.url] = true;
    out.push(img);
  }
  // https first (the webview and get_cue_context prefer it), otherwise keep
  // DuckDuckGo's own relevance order.
  return out.filter(function (x) { return /^https:/.test(x.url); })
    .concat(out.filter(function (x) { return !/^https:/.test(x.url); }));
}

// ---------------------------------------------------------------------------
// Image providers
// ---------------------------------------------------------------------------
function found(img) {
  // The host downloads this itself; a browser UA and the page as referer get
  // past most hotlink checks.
  var headers = { "User-Agent": USER_AGENT };
  if (img.pageUrl) headers.Referer = img.pageUrl;
  return { status: "ok", url: img.url, headers: headers };
}

function failed(e) {
  return { status: "error", message: e && e.message ? e.message : String(e) };
}

async function fetchArtistImage(name) {
  if (!normName(name)) return { status: "not_found" };
  try {
    var raw = await searchRaw(name + " musician", {});
    var hits = pick(raw, {
      minWidth: ARTIST_MIN_WIDTH,
      minAspect: 0.5,
      maxAspect: 2.2,
      mention: [name],
      reject: NOT_AN_ARTIST_PHOTO,
    });
    // A square result is often a sleeve the word filter missed; take one only
    // when nothing else is left.
    var shaped = hits.filter(function (h) { var a = aspect(h); return a < 0.95 || a > 1.05; });
    var best = shaped[0] || hits[0];
    return best ? found(best) : { status: "not_found" };
  } catch (e) {
    return failed(e);
  }
}

async function fetchAlbumImage(title, artistName) {
  if (!normName(title)) return { status: "not_found" };
  try {
    var q = (artistName ? artistName + " " : "") + title + " album cover";
    var raw = await searchRaw(q, { layout: LAYOUTS.square });
    // Covers are square; 0.9–1.1 allows for scans and a stray border.
    var mention = [title];
    var hits = pick(raw, { minWidth: ALBUM_MIN_WIDTH, minAspect: 0.9, maxAspect: 1.1, mention: mention });
    // An album named like a common word ("Third") only counts when the
    // artist is named too; prefer those hits, and require them when the
    // title is short.
    if (artistName) {
      var both = hits.filter(function (h) { return accept(h, { mention: [artistName] }); });
      if (both.length || normName(title).length < 6) hits = both;
    }
    return hits.length ? found(hits[0]) : { status: "not_found" };
  } catch (e) {
    return failed(e);
  }
}

// ---------------------------------------------------------------------------
// Assistant tool: search_images
// ---------------------------------------------------------------------------
function intArg(v, def, min, max) {
  if (v === undefined || v === null || v === "") return def;
  var n = Number(v);
  if (!isFinite(n)) throw new Error("expected a number, got " + JSON.stringify(v));
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function strArg(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function enumArg(v, table, what) {
  var s = strArg(v);
  if (!s || s === "any") return null;
  var key = s.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error("Unknown " + what + " '" + s + "' — use one of: any, " + Object.keys(table).join(", "));
  }
  return table[key];
}

async function searchImages(args) {
  args = args || {};
  var q = strArg(args.query);
  if (!q) throw new Error("query is required");
  var layout = enumArg(args.layout, LAYOUTS, "layout");
  var license = enumArg(args.license, LICENSES, "license");
  var minWidth = intArg(args.minWidth, DEFAULT_MIN_WIDTH, 0, 10000);
  var limit = intArg(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  var raw = await searchRaw(q, { layout: layout, license: license });
  var images = pick(raw, { minWidth: minWidth }).slice(0, limit).map(function (img) {
    var out = {
      url: img.url,
      width: img.width,
      height: img.height,
      title: img.title,
      pageUrl: img.pageUrl,
      site: img.site,
    };
    if (args.thumbnails === true && img.thumbUrl) out.thumbUrl = img.thumbUrl;
    return out;
  });
  return {
    query: q,
    layout: layout ? strArg(args.layout).toLowerCase() : "any",
    license: license ? strArg(args.license).toLowerCase() : "any",
    images: images,
    note: license
      ? "Bing's licence filter, as reported by DuckDuckGo — check the page before relying on it. Credit the site."
      : "Web search results: rights are unknown and titles describe the page, not always the image. Credit the site, and prefer license=share for anything published.",
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function activate(pluginApi) {
  api = pluginApi;
  api.imageProviders.onFetch("artist", fetchArtistImage);
  api.imageProviders.onFetch("album", fetchAlbumImage);
  if (api.assistant) api.assistant.onTool("search_images", searchImages);
}

function deactivate() {
  api = null;
}

return {
  activate: activate,
  deactivate: deactivate,
  // Exposed for tests.
  _normName: normName,
  _mentions: mentions,
  _parseVqd: parseVqd,
  _filterParam: filterParam,
  _toImage: toImage,
  _pick: pick,
  _fetchArtistImage: fetchArtistImage,
  _fetchAlbumImage: fetchAlbumImage,
  _searchImages: searchImages,
};
