// Runs worker/index.js outside Cloudflare: fake D1, the assets emulation and a per-test Cache API.
import {createD1} from "./d1.mjs";
import {createAssets} from "./assets.mjs";
import worker from "../../worker/index.js";

export function installCache() {
  const store = new Map();
  globalThis.caches = {default: {
    async match(req) { const r = store.get(typeof req === "string" ? req : req.url); return r ? r.clone() : undefined; },
    async put(req, res) { store.set(typeof req === "string" ? req : req.url, res.clone()); },
  }};
  return store;
}

export function createWorker(opts = {}) {
  const cache = installCache();
  const env = {DB: opts.db || createD1(opts), ASSETS: opts.assets || createAssets()};
  const pending = [];
  const ctx = {waitUntil: p => pending.push(p), passThroughOnException() {}};
  const call = async (pathOrReq, init = {}) => {
    const req = pathOrReq instanceof Request ? pathOrReq : new Request(new URL(pathOrReq, "https://inflationdle.com"), init);
    const res = await worker.fetch(req, env, ctx);
    await Promise.all(pending.splice(0));
    return res;
  };
  return {env, ctx, cache, fetch: call};
}
