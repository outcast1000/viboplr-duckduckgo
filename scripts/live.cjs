#!/usr/bin/env node
// Run the plugin against the REAL DuckDuckGo, the way the worker would (same
// sandbox, api.network.fetch backed by Node's fetch, limited to the manifest's
// hosts). Not part of `npm test` — it needs the network.
//
//   node scripts/live.cjs artist "Portishead"
//   node scripts/live.cjs album "Dummy" "Portishead"
//   node scripts/live.cjs search '{"query":"Portishead live","limit":5}'
//
// Add --check to also download the provider's pick with the headers it
// returned, the way the app would.
const { loadPlugin } = require("../test/harness/sandbox");
const manifest = require("../manifest.json");

const allowed = manifest.permissions.filter((p) => p.startsWith("network:")).map((p) => p.slice(8));

const api = {
  appVersion: "live",
  log: (level, message) => console.error(`[${level}] ${message}`),
  network: {
    async fetch(url, init = {}) {
      const host = new URL(url).hostname;
      if (!allowed.includes(host)) throw new Error(`PermissionError: network:${host} not in manifest`);
      const ctl = new AbortController();
      const t = init.timeoutMs ? setTimeout(() => ctl.abort(), init.timeoutMs) : null;
      try {
        const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal, redirect: "manual" });
        const text = await r.text();
        return { status: r.status, headers: Object.fromEntries(r.headers), url: r.url, text: async () => text, json: async () => JSON.parse(text) };
      } finally {
        if (t) clearTimeout(t);
      }
    },
  },
  imageProviders: { handlers: {}, onFetch(entity, h) { this.handlers[entity] = h; } },
  assistant: { tools: {}, onTool(name, h) { this.tools[name] = h; } },
};

(async () => {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const [mode, a, b] = argv.filter((x) => x !== "--check");
  const plugin = loadPlugin();
  plugin.activate(api);
  const started = Date.now();
  let out;
  if (mode === "artist") out = await api.imageProviders.handlers.artist(a);
  else if (mode === "album") out = await api.imageProviders.handlers.album(a, b);
  else if (mode === "search") out = await api.assistant.tools.search_images(JSON.parse(a));
  else {
    console.error("usage: live.cjs artist <name> | album <title> [artist] | search <json args> [--check]");
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
  console.error(`(${Date.now() - started} ms)`);
  if (check && out && out.url) {
    const r = await fetch(out.url, { headers: out.headers });
    const buf = Buffer.from(await r.arrayBuffer());
    console.error(`download: HTTP ${r.status}, ${r.headers.get("content-type")}, ${buf.length} bytes`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
