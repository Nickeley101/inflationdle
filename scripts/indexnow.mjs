// Submits changed page URLs to IndexNow (Bing and others). Run by .github/workflows/indexnow.yml after a push to main:
// the pages whose files changed in the push, or with ALL=true every URL in sitemap.xml.
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const HOST = "inflationdle.com";
const key = readdirSync(".").find(f => /^[0-9a-f]{32}\.txt$/.test(f)).slice(0, -4);
const sitemap = [...readFileSync("sitemap.xml", "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

let urls = sitemap;
if (process.env.ALL !== "true") {
  const before = /^[0-9a-f]{40}$/.test(process.env.BEFORE || "") && !/^0+$/.test(process.env.BEFORE) ? process.env.BEFORE : "HEAD~1";
  let files;
  try { files = execSync(`git diff --name-only ${before} HEAD`, { encoding: "utf8" }).split("\n").filter(Boolean) }
  catch { files = execSync("git diff --name-only HEAD~1 HEAD", { encoding: "utf8" }).split("\n").filter(Boolean) }
  const url = f => f === "index.html" ? `https://${HOST}/` : f === "prices/index.html" ? `https://${HOST}/prices/`
    : `https://${HOST}/${f.replace(/\.html$/, "")}`;
  urls = [...new Set(files.filter(f => /\.html$/.test(f)).map(url))].filter(u => sitemap.includes(u));
}
if (!urls.length) { console.log("No listed pages changed."); process.exit(0) }
if (process.env.DRY_RUN) { console.log(`Would submit ${urls.length} URL(s) with key ${key}:\n${urls.join("\n")}`); process.exit(0) }

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList: urls.slice(0, 10000) }),
});
console.log(`IndexNow: ${res.status} for ${urls.length} URL(s)\n${urls.join("\n")}`);
// 200 and 202 mean accepted. 403 means the key file isn't live yet (first run before the deploy finished).
if (![200, 202].includes(res.status)) { console.log(await res.text()); process.exit(1) }
