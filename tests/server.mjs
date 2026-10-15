// Local copy of inflationdle.com for the browser tests: the real Worker (worker/index.js) in front of the repo's
// static files, with the _headers security headers, .assetsignore and an in-memory visitor counter.
//   node tests/server.mjs [port]
import {createServer} from "node:http";
import {createWorker} from "./lib/worker-env.mjs";

const port = Number(process.argv[2] || process.env.PORT || 4173);
const {fetch} = createWorker();

createServer(async (req, res) => {
  try {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise(r => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    headers.set("cf-connecting-ip", req.headers["x-test-ip"] || req.socket.remoteAddress || "");
    const out = await fetch(new Request(`http://localhost:${port}${req.url}`, {method: req.method, headers, body}));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end("server error");
  }
}).listen(port, () => console.log(`Inflationdle test server on http://localhost:${port}`));
