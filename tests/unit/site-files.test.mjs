// What gets published on inflationdle.com, and the security rules in the published HTML and _headers.
import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import path from "node:path";
import {ROOT} from "../lib/paths.mjs";
import {isIgnored, ignoreRules, headerRules} from "../lib/assets.mjs";

const tracked = execFileSync("git", ["ls-files"], {cwd: ROOT, encoding: "utf8"}).split("\n").filter(Boolean);
const rules = ignoreRules();
const published = tracked.filter(f => !isIgnored(f, rules) && !["_headers", ".assetsignore"].includes(f));

// Everything the site is meant to serve. A new file outside these needs adding here on purpose, or to .assetsignore.
const ALLOWED = [/^index\.html$/, /^privacy\.html$/, /^robots\.txt$/, /^sitemap\.xml$/, /^[\w-]+\.(png|ico|svg)$/,
  /^src\/[\w.-]+\.(js|css)$/, /^data\/[\w.-]+\.json$/, /^data\/countries\/[\w.-]+\.json$/, /^prices\/[\w-]+\.html$/, /^prices\/pages\.json$/,
  /^[0-9a-f]{32}\.txt$/]; // the IndexNow key file (public by design, see scripts/indexnow.mjs)

test("only the site's own files are published", () => {
  const extra = published.filter(f => !ALLOWED.some(re => re.test(f)));
  assert.deepEqual(extra, [], "these would be public on inflationdle.com; add them to .assetsignore or to ALLOWED");
});

test("scripts, docs, workflows, tool files, the Worker source and tests stay off the site", () => {
  for (const f of ["scripts/schedule.mjs", ".github/workflows/tests.yml",
    "worker/index.js", "worker/schema.sql", "wrangler.jsonc", "cron/index.js", "README.md", "promo/header.html", "tests/server.mjs",
    "tests/node_modules/x.js", "node_modules/x.js", ".git/config", ".env", ".dev.vars"])
    assert.ok(isIgnored(f, rules) || [".env", ".dev.vars"].includes(f) && !tracked.includes(f), `${f} would be published`);
  for (const dir of ["scripts", "docs", ".github", ".claude", "worker", "cron", "promo", "tests"])
    assert.ok(tracked.filter(f => f.startsWith(dir + "/")).every(f => isIgnored(f, rules)), `${dir}/ has published files`);
});

test("no secrets or private keys are committed anywhere", () => {
  const PATTERNS = [
    [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
    [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/, "GitHub token"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS key"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
    [/\bsk-(ant-)?[A-Za-z0-9_-]{32,}/, "API secret key"],
    [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
    [/\b(ya29\.[0-9A-Za-z_-]{20,}|1\/\/0[0-9A-Za-z_-]{30,})/, "Google OAuth token"],
    [/(api[_-]?key|secret|password|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-+/]{24,}["']/i, "hard-coded credential"],
  ];
  const hits = [];
  for (const f of tracked) {
    if (/\.(png|jpe?g|gif|mp4|mp3|wav|ico|woff2?|ttf|zip)$/i.test(f)) continue;
    let text; try { text = readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
    for (const [re, what] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${what}`);
  }
  assert.deepEqual(hits, []);
});

const headerFor = (p, name) => {
  const esc = s => s.split("*").map(x => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  let v = null;
  for (const r of headerRules()) if (new RegExp("^" + esc(r.pattern) + "$").test(p)) for (const [k, val] of r.headers) if (k.toLowerCase() === name) v = val;
  return v;
};

test("_headers sends the security headers on every page", () => {
  for (const p of ["/", "/index.html", "/prices/eggs", "/privacy.html", "/data/prices.json"]) {
    const csp = headerFor(p, "content-security-policy");
    assert.ok(csp, `CSP on ${p}`);
    const dir = Object.fromEntries(csp.split(";").map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(dir["default-src"], ["'self'"]);
    assert.ok(!dir["script-src"].includes("'unsafe-inline'") && !dir["script-src"].includes("'unsafe-eval'"), "no inline or eval scripts");
    assert.ok(!dir["script-src"].some(s => s === "*" || s === "https:" || s === "data:"), "no wildcard script sources");
    assert.deepEqual(dir["frame-ancestors"], ["'none'"], "can't be framed (clickjacking)");
    assert.deepEqual(dir["base-uri"], ["'self'"]);
    assert.ok(dir["form-action"], "form-action set");
    assert.ok(!dir["connect-src"]?.includes("*"), "connect-src not open");
    assert.match(headerFor(p, "strict-transport-security") || "", /max-age=(\d{8,})/, "HSTS for at least ~4 months");
    assert.equal(headerFor(p, "x-content-type-options"), "nosniff");
    assert.match(headerFor(p, "referrer-policy") || "", /strict-origin|no-referrer|same-origin/);
    assert.ok(headerFor(p, "permissions-policy"), "Permissions-Policy");
  }
});

const htmlFiles = published.filter(f => f.endsWith(".html"));

test("published HTML has no inline scripts or event handlers the CSP would block", () => {
  const bad = [];
  for (const f of htmlFiles) {
    const html = readFileSync(path.join(ROOT, f), "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1];
      if (/type=["']application\/ld\+json["']/i.test(attrs)) continue;
      if (/\bsrc=/.test(attrs) && !m[2].trim()) {
        const src = /src=["']([^"']+)/.exec(attrs)[1];
        if (/^(https?:)?\/\//.test(src) && !src.startsWith("https://static.cloudflareinsights.com/")) bad.push(`${f}: third-party script ${src}`);
        continue;
      }
      bad.push(`${f}: inline <script>`);
    }
    for (const m of html.matchAll(/<[a-z][^>]*\son[a-z]+\s*=/gi)) bad.push(`${f}: inline handler ${m[0].slice(0, 60)}`);
    if (/javascript:/i.test(html)) bad.push(`${f}: javascript: URL`);
  }
  assert.deepEqual(bad, []);
});

test("links that open a new tab use rel=noopener, and nothing loads over plain http", () => {
  const bad = [];
  for (const f of htmlFiles) {
    const html = readFileSync(path.join(ROOT, f), "utf8");
    for (const m of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) if (!/rel=["'][^"']*noopener/.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
    for (const m of html.matchAll(/\b(src|href)=["']http:\/\/[^"']+/gi)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("the game script never writes page HTML from the URL or other untrusted input", () => {
  // innerHTML in src/game.js is built from our own data files. The one piece of user input, ?c=, has to pass
  // /^[a-z]{2}$/ before it's used; keep that guard.
  const js = readFileSync(path.join(ROOT, "src/game.js"), "utf8");
  assert.match(js, /\/\^\[a-z\]\{2\}\$\/\.test\(c\)/, "the ?c= guard is still there");
  assert.doesNotMatch(js, /\beval\(|new Function\(|document\.write\(/);
  assert.doesNotMatch(js, /innerHTML\s*=[^;]*(location\.|URLSearchParams|document\.referrer|window\.name)/, "innerHTML from the URL");
});
