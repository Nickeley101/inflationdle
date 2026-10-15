// Emulates what Cloudflare serves for the repo: static assets from the repo root minus .assetsignore, with the
// headers from _headers, and "auto-trailing-slash" HTML handling (/prices/eggs serves prices/eggs.html and
// /prices/eggs.html redirects to /prices/eggs). The Worker gets this as env.ASSETS, as in production.
import {readFileSync, statSync, existsSync} from "node:fs";
import path from "node:path";
import {ROOT} from "./paths.mjs";

const TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8",
  ".sql": "text/plain; charset=utf-8", ".jsonc": "application/json", ".mp4": "video/mp4", ".woff2": "font/woff2"};

// .assetsignore uses .gitignore syntax; the repo only uses "name" and "dir/" lines, which is what this handles.
export function ignoreRules(root = ROOT) {
  return readFileSync(path.join(root, ".assetsignore"), "utf8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
}
export function isIgnored(rel, rules = ignoreRules()) {
  const parts = rel.replace(/^\/+/, "").split("/");
  return rules.some(r => {
    const dir = r.endsWith("/"), name = r.replace(/^\/|\/$/g, "");
    if (name.includes("/")) return rel.replace(/^\/+/, "").startsWith(name + (dir ? "/" : ""));
    return dir ? parts.slice(0, -1).includes(name) : parts.includes(name);
  });
}
// Cloudflare never serves these config files as assets.
const NEVER = new Set(["_headers", "_redirects", ".assetsignore"]);

export function headerRules(root = ROOT) {
  const rules = [];
  let cur = null;
  for (const line of readFileSync(path.join(root, "_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { cur = {pattern: line.trim(), headers: []}; rules.push(cur); continue; }
    const i = line.indexOf(":");
    cur?.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}
const matches = (pattern, p) => new RegExp("^" + pattern.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(p);

export function createAssets(root = ROOT) {
  const rules = ignoreRules(root), hdrs = headerRules(root);
  const withHeaders = (pathname, res) => {
    for (const r of hdrs) if (matches(r.pattern, pathname)) for (const [k, v] of r.headers) res.headers.set(k, v);
    return res;
  };
  return {
    async fetch(req) {
      const url = new URL(typeof req === "string" ? req : req.url);
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { return new Response("Bad request", {status: 400}); }
      if (p.includes("\0") || p.split("/").includes("..")) return new Response("Not found", {status: 404});
      const notFound = () => withHeaders(url.pathname, new Response("Not found", {status: 404, headers: {"content-type": "text/plain"}}));
      if (isIgnored(p.replace(/^\/+/, ""), rules)) return notFound();
      if (/\.html$/.test(p)) {
        const to = p.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
        return new Response(null, {status: 307, headers: {location: to + url.search}});
      }
      const candidates = p.endsWith("/") ? [p + "index.html"] : [p, p + ".html"];
      if (!p.endsWith("/") && !path.extname(p) && !isIgnored(p.slice(1) + "/x", rules) && existsSync(path.join(root, p)) && statSync(path.join(root, p)).isDirectory())
        return new Response(null, {status: 307, headers: {location: p + "/" + url.search}});
      for (const c of candidates) {
        const rel = c.replace(/^\/+/, ""), file = path.join(root, rel);
        if (!file.startsWith(root + path.sep) || NEVER.has(path.basename(rel)) || isIgnored(rel, rules)) continue;
        if (!existsSync(file) || !statSync(file).isFile()) continue;
        const type = TYPES[path.extname(file)] || "application/octet-stream";
        return withHeaders(url.pathname, new Response(readFileSync(file), {status: 200, headers: {"content-type": type}}));
      }
      return notFound();
    },
  };
}
