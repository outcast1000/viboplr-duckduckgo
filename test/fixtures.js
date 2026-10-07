// DuckDuckGo responses shaped like the real ones (recorded against the live
// site on 2026-10-07 and trimmed): the token page is HTML carrying vqd="…",
// i.js is JSON with a `results` array of Bing image hits.

const VQD = "4-216154148118446998741475182419293052553";

const TOKEN_PAGE = `<!DOCTYPE html><html><head><title>DuckDuckGo</title></head><body>
<script>DDG.deep.initialize('/d.js?q=portishead&l=us-en&s=0&dl=en&ct=GR&vqd=${VQD}&p=1');</script>
<input name="vqd" value="x"><script>vqd="${VQD}";</script></body></html>`;

function hit(image, o = {}) {
  return {
    discovery_date: "2025-02-18T05:55:00.0000000Z",
    encoding_format: o.format === undefined ? "jpeg" : o.format,
    width: o.width ?? 1600,
    height: o.height ?? 1000,
    image,
    image_token: "t",
    source: "Bing",
    thumbnail: o.thumbnail ?? "https://tse3.mm.bing.net/th/id/OIP.abc?r=0&pid=Api",
    thumbnail_token: "t",
    title: o.title ?? "",
    url: o.url ?? "https://example.com/page",
  };
}

function page(results) {
  return { ads: null, next: "i.js?q=x&o=json&p=1&s=100", query: "x", response_type: "images", results, vqd: { x: VQD } };
}

const ARTIST = page([
  // A stock library, a sleeve, a square, a thumbnail and a plain-http hit come
  // before the photo that should win.
  hit("https://c8.alamy.com/comp/portishead-live.jpg", { title: "Portishead live Stock Photo - Alamy", url: "https://www.alamy.com/x" }),
  hit("https://www.progarchives.com/progressive_rock_discography_covers/6072/cover_1.jpg", { title: "PORTISHEAD Dummy reviews", width: 1000, height: 1000 }),
  hit("https://images.example.org/portishead-square.jpg", { title: "Portishead on Amazon Music", width: 2400, height: 2400 }),
  hit("https://www.example.com/bushwick.jpg", { title: "Bushwick nights", width: 2000, height: 1200, url: "https://www.example.com/" }),
  hit("https://small.example.com/tiny.jpg", { title: "Portishead band", width: 300, height: 200 }),
  hit("http://www.laut.de/Portishead/portishead-167417.jpg", { title: "Portishead - laut.de - Band", width: 1024, height: 768, url: "https://laut.de/Portishead" }),
  hit("https://wallpapercave.com/wp/wp9440792.jpg", { title: "Portishead Wallpapers", width: 1920, height: 1080, url: "https://wallpapercave.com/portishead-wallpapers" }),
  hit("https://anim.example.com/portishead.gif", { title: "Portishead", format: "gif" }),
]);

const ALBUM = page([
  hit("https://shop.example.com/third.jpg", { title: "Third (vinyl) | Record Shop", width: 1200, height: 1200 }),
  hit("https://e.snmc.io/i/600/portishead-dummy-cover-art.png", { title: "Dummy by Portishead (Album, Trip Hop)", width: 600, height: 592, format: "png", url: "https://rateyourmusic.com/release/album/portishead/dummy/" }),
  hit("https://wide.example.com/dummy-wide.jpg", { title: "Portishead Dummy anniversary", width: 2000, height: 1200 }),
]);

module.exports = { VQD, TOKEN_PAGE, hit, page, ARTIST, ALBUM };
