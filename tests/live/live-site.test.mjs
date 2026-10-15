// Checks against the real site (default https://inflationdle.com; set SITE to try another address). They read
// only: nothing here counts as a visitor or changes anything. Run by .github/workflows/live-site.yml.
import {test} from "node:test";
import assert from "node:assert/strict";
import {liveSyms, pricePages} from "../lib/game-data.mjs";

const SITE = (process.env.SITE || "https://inflationdle.com").replace(/\/$/, "");
const UA = "Mozilla/5.0 (inflationdle-live-check)";
const get = (p, init = {}) => fetch(SITE + p, {redirect: "manual", ...init, headers: {"user-agent": UA, ...(init.headers || {})}});

test("the site is up and the game page has its security headers", async t => {
  const res = await get("/");
  // Cloudflare's bot protection answers GitHub's servers with a "Just a moment..." challenge on the home page.
  // That's the zone's bot setting, not the Worker; the workers.dev run checks the same page without it.
  if (res.headers.get("cf-mitigated") === "challenge") return t.skip("Cloudflare bot challenge on / from CI");
  if (res.status !== 200) {
    const why = ["server", "cf-mitigated", "cf-ray", "content-type"].map(k => `${k}=${res.headers.get(k)}`).join(" ");
    assert.fail(`GET / answered ${res.status} (${why}): ${(await res.text()).replace(/\s+/g, " ").slice(0, 300)}`);
  }
  const h = k => res.headers.get(k) || "";
  assert.match(h("content-security-policy"), /default-src 'self'/);
  assert.match(h("content-security-policy"), /frame-ancestors 'none'/);
  assert.doesNotMatch(h("content-security-policy"), /script-src[^;]*'unsafe-(inline|eval)'/);
  assert.match(h("strict-transport-security"), /max-age=\d{7,}/);
  assert.equal(h("x-content-type-options"), "nosniff");
  assert.ok(h("referrer-policy"));
  assert.ok(h("permissions-policy"));
  assert.match(await res.text(), /Inflation<em>dle<\/em>/);
});

test("price pages get the security headers too", async () => {
  const live = liveSyms(), pages = pricePages();
  const shown = Object.keys(pages).find(p => !live.has(pages[p]));
  for (const p of ["/prices/", shown, "/privacy.html"]) {
    let res = await get(p);
    if ([301, 307, 308].includes(res.status)) res = await get(new URL(res.headers.get("location"), SITE).pathname);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/, `CSP on ${p}`);
  }
});

// Known gap, found 2026-09-27: http://inflationdle.com serves the page instead of redirecting, so a first visit
// typed without https isn't encrypted (HSTS only helps after one https visit). Fix: Cloudflare dashboard >
// inflationdle.com > SSL/TLS > Edge Certificates > turn on "Always Use HTTPS". Drop `todo` once it's on.
// workers.dev is skipped: every .dev address is https-only in browsers already (HSTS preload).
test("plain http redirects to https", {skip: SITE.endsWith(".workers.dev") && "the .dev domain is https-only in browsers", todo: !SITE.endsWith(".workers.dev") && "Always Use HTTPS is off"}, async () => {
  const res = await fetch(SITE.replace(/^https:/, "http:") + "/", {redirect: "manual", headers: {"user-agent": UA}});
  assert.ok([301, 302, 307, 308].includes(res.status), `status ${res.status}`);
  assert.match(res.headers.get("location") || "", /^https:\/\//);
});

test("private files and folders aren't served", async () => {
  const leaks = [];
  for (const p of ["/scripts/schedule.mjs", "/scripts/post-to-x.mjs",
    "/.github/workflows/daily-x-post.yml", "/worker/index.js", "/worker/schema.sql",
    "/wrangler.jsonc", "/cron/index.js", "/cron/wrangler.jsonc", "/README.md", "/promo/header.html", "/tests/package.json",
    "/.git/config", "/.git/HEAD", "/.env", "/.dev.vars", "/.assetsignore", "/_headers", "/package.json"]) {
    const res = await get(p);
    const body = res.status === 200 ? await res.text() : "";
    // A soft 404 (the game page served for an unknown path) is fine; the file itself is not.
    if (res.status === 200 && !/Inflation<em>dle<\/em>/.test(body)) leaks.push(`${p} (${res.status})`);
  }
  assert.deepEqual(leaks, []);
});

test("the visitor counter API answers reads and refuses other methods", async () => {
  const res = await get("/api/visitors");
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(Number.isInteger(j.total) && Number.isInteger(j.today) && j.total >= j.today);
  assert.deepEqual(Object.keys(j).sort(), ["today", "total"]);
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const r = await get("/api/visitors", {method});
    assert.ok([404, 405].includes(r.status), `${method} → ${r.status}`);
  }
  assert.equal((await get("/api/admin")).status, 404);
});

test("a live item's price history is hidden, whichever way the URL is written", async () => {
  const live = liveSyms(), pages = pricePages();
  const hidden = Object.keys(pages).filter(p => live.has(pages[p]));
  if (!hidden.length) return;
  const leaks = [];
  for (const p of hidden) {
    const enc = p.replace(/\/([a-z])/g, (m, c) => "/%" + c.charCodeAt(0).toString(16));
    for (const v of [p, p + ".html", p + "/", p + "?utm=1", p.replace("/prices/", "/prices//"), p.replace("/prices", "/%70rices"),
      enc, p.replace(/-/, "%2D"), p.toUpperCase(), p + "/index.html"]) {
      let res = await get(v), hops = 0;
      while ([301, 302, 307, 308].includes(res.status) && hops++ < 5) res = await get(new URL(res.headers.get("location"), SITE + "/").pathname + new URL(res.headers.get("location"), SITE + "/").search);
      const body = await res.text();
      if (res.status === 200 && /<table/i.test(body)) leaks.push(v);
    }
  }
  assert.deepEqual(leaks, [], "these URLs showed a live item's prices");
  const index = await (await get("/prices/")).text();
  for (const sym of live) assert.doesNotMatch(index, new RegExp(`data-sym="${sym}"`), `${sym} is listed on /prices/`);
});

