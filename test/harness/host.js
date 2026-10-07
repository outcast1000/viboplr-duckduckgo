// A fake plugin API plus a scripted DuckDuckGo: enough of ViboplrPluginAPI for
// activate() and the handlers. Requests are recorded so tests can assert on
// what was asked.

function response(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" },
    async json() { return JSON.parse(text); },
    async text() { return text; },
  };
}

// opts.route(url: URL) → { status?, body } | body | undefined (404)
function makeHost(opts = {}) {
  const requests = [];
  const logs = [];
  const imageHandlers = {};
  const tools = {};

  const api = {
    appVersion: "1.0.92",
    log: (level, message) => logs.push({ level, message }),
    network: {
      async fetch(url, init) {
        const u = new URL(url);
        requests.push({ url: u, init });
        const out = opts.route ? opts.route(u) : undefined;
        if (out === undefined) return response(404, "not found");
        if (out && typeof out.status === "number" && "body" in out) return response(out.status, out.body);
        return response(200, out);
      },
    },
    imageProviders: {
      onFetch(entity, handler) { imageHandlers[entity] = handler; },
    },
    assistant: {
      onTool(name, handler) { tools[name] = handler; },
    },
  };

  return { api, requests, logs, imageHandlers, tools };
}

module.exports = { makeHost, response };
