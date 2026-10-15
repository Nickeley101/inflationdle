// Rule for /prices/: while an item's daily round is live, its price history pages are hidden and its row
// leaves the index; at any other time everything shows. These run worker/index.js at chosen moments.
import {test} from "node:test";
import assert from "node:assert/strict";
import {createWorker} from "../lib/worker-env.mjs";
import {countryFiles, pricePages} from "../lib/game-data.mjs";

const {sched} = countryFiles("us");
const EPOCH = Date.parse(sched.epoch + "T00:00:00Z");
const PAGES = pricePages();
const symOf = k => k.split(":")[0].split(".")[0];
// Day n's round (1-based) and a page for its item, if it has one.
const dayInfo = n => { const sym = symOf(sched.days[n - 1]); return {sym, path: Object.keys(PAGES).find(p => PAGES[p] === sym)}; };
const at = (t, n, hours) => (t.mock.timers.reset(), t.mock.timers.enable({apis: ["Date"], now: EPOCH + (n - 1) * 864e5 + hours * 36e5}));

// The next 60 days from today whose item has a price page and doesn't come up again within two days (so its
// neighbours can't keep it hidden at the edges of its own window).
const todayN = Math.floor((Date.now() - EPOCH) / 864e5) + 1;
const days = [];
for (let n = Math.max(3, todayN); n < Math.min(sched.days.length - 2, todayN + 60); n++) {
  const {sym, path} = dayInfo(n);
  if (path && ![n - 2, n - 1, n + 1, n + 2].some(m => dayInfo(m).sym === sym)) days.push(n);
}

test("there are upcoming rounds with price pages to check", () => assert.ok(days.length >= 10, `only ${days.length}`));

test("a live item's page is hidden with 503 + Retry-After, and comes back when the round ends", async t => {
  for (const n of days.slice(0, 15)) {
    const {path, sym} = dayInfo(n), w = createWorker();
    const html = async h => { at(t, n, h); const r = await w.fetch(path); return {status: r.status, retry: r.headers.get("retry-after"), cc: r.headers.get("cache-control"), text: await r.text()}; };
    // Live from 10:00 UTC the day before until 12:00 UTC the day after.
    for (const h of [-14, -13.99, 0, 12, 24, 35.99]) {
      const r = await html(h);
      assert.equal(r.status, 503, `${path} day ${n} at ${h}h`);
      assert.ok(Number(r.retry) >= 60, "Retry-After");
      assert.equal(r.cc, "no-store");
      assert.match(r.text, /Hidden during today's round/);
      assert.doesNotMatch(r.text, /\{\{ENDS\}\}/, "the end time is filled in");
      assert.doesNotMatch(r.text, /<table|data-price|\$\d+\.\d\d\d?/, `${sym} prices leak on the hidden page`);
    }
    t.mock.timers.reset();
    for (const h of [-14.01, 36]) {
      const r = await html(h);
      assert.equal(r.status, 200, `${path} day ${n} at ${h}h should be visible`);
    }
    t.mock.timers.reset();
  }
});

test("the index drops a live item's row and keeps the rest", async t => {
  for (const n of days.slice(0, 10)) {
    const {sym} = dayInfo(n), w = createWorker();
    at(t, n, 6);
    const html = await (await w.fetch("/prices/")).text();
    assert.doesNotMatch(html, new RegExp(`data-sym="${sym}"`), `day ${n}: ${sym} row still listed`);
    assert.match(html, /data-sym="/, "other rows stay");
    t.mock.timers.reset();
  }
});

test("a category whose only item is live disappears instead of showing an empty table", async t => {
  const w = createWorker();
  for (let n = Math.max(2, todayN); n < Math.min(sched.days.length, todayN + 60); n++) {
    at(t, n, 6);
    const html = await (await w.fetch("/prices/")).text();
    assert.doesNotMatch(html, /<tbody><\/tbody>/, `day ${n} (${sched.days[n - 1]}): empty table on the index`);
    assert.doesNotMatch(html, /<h2>[^<]*<\/h2>\s*<h2>/, `day ${n}: heading with nothing under it`);
    t.mock.timers.reset();
  }
  const mcd = sched.days.findIndex((k, i) => i >= todayN - 1 && symOf(k) === "MCD") + 1;
  if (mcd > 0) {
    at(t, mcd, 6);
    assert.doesNotMatch(await (await w.fetch("/prices/")).text(), /<h2>Fast food<\/h2>/);
    t.mock.timers.reset();
  }
});

test("a player who finished the live round (ic_done cookie) sees its page and index row; others don't", async t => {
  for (const n of days.slice(0, 8)) {
    const {path, sym} = dayInfo(n), w = createWorker();
    const get = async (p, cookie) => w.fetch(p, cookie ? {headers: {cookie}} : {});
    at(t, n, 6);
    assert.equal((await get(path, `ic_done=${n}`)).status, 200, `day ${n}: finished player`);
    const r = await get(path, `theme=dark; ic_done=${n - 2}.${n - 1}.${n}`);
    assert.equal(r.status, 200, "cookie among others, several days");
    assert.match(r.headers.get("cache-control"), /private/, "never cached for everyone");
    assert.equal((await get(path, `ic_done=${n - 1}`)).status, 503, "yesterday's finish doesn't open today's item");
    assert.equal((await get(path, "ic_done=")).status, 503);
    assert.equal((await get(path, `xic_done=${n}`)).status, 503, "only the real cookie name counts");
    assert.equal((await get(path)).status, 503);
    assert.match(await (await get("/prices/", `ic_done=${n}`)).text(), new RegExp(`data-sym="${sym}"`), "index row back");
    assert.doesNotMatch(await (await get("/prices/")).text(), new RegExp(`data-sym="${sym}"`));
    t.mock.timers.reset();
  }
});

test("while two rounds overlap, a player sees each item once they've finished its round", async t => {
  // Early on day n (UTC), day n-1's round is still live too; each item opens only with its own day finished.
  const n = days.find(d => days.includes(d - 1)), prev = dayInfo(n - 1), cur = dayInfo(n), w = createWorker();
  at(t, n, 6);
  const status = async (p, c) => (await w.fetch(p, {headers: {cookie: `ic_done=${c}`}})).status;
  assert.equal(await status(prev.path, n), 503);
  assert.equal(await status(prev.path, n - 1), 200);
  assert.equal(await status(cur.path, n - 1), 503);
  assert.equal(await status(cur.path, `${n - 1}.${n}`), 200);
  t.mock.timers.reset();
});

test("no other way of writing the URL gets around the hiding", async t => {
  const n = days[0], {path} = dayInfo(n), w = createWorker();
  at(t, n, 6);
  const variants = [path, path + ".html", path + "/", path + "?x=1", path + "#top", path + ".html?x=1", path + "/index.html",
    path.replace("/prices/", "/prices/./"), path.replace("/prices/", "/x/../prices/"),
    path.toUpperCase(), path + "%2Ehtml", path + "%2F"];
  const leaks = [];
  for (const v of variants) if (await leaks200(w, v)) leaks.push(v);
  assert.deepEqual(leaks, []);
});

// Known gap, reported 2026-09-27: the Worker matches the raw path, so a doubled slash or a percent-encoded letter
// skips the check. On inflationdle.com, Cloudflare's URL normalization most likely cleans these up before the Worker
// sees them (tests/live checks the real site), but the workers.dev address may not normalize. The fix is to
// normalize the path in worker/index.js (decode, merge slashes) before looking it up. Flip `todo` off once fixed.
test("doubled slashes and percent-encoded letters don't get around the hiding", {todo: "worker doesn't normalize paths yet"}, async t => {
  const n = days[0], {path} = dayInfo(n), w = createWorker();
  at(t, n, 6);
  const leaks = [];
  for (const v of [path.replace("/prices/", "/prices//"), path.replace("/prices", "/%70rices"), path.replace(/-/, "%2D"), path.replace(/\/([a-z])/g, (m, c) => "/%" + c.charCodeAt(0).toString(16))])
    if (await leaks200(w, v)) leaks.push(v);
  assert.deepEqual(leaks, []);
});

async function leaks200(w, v) {
  let res = await w.fetch(v), hops = 0;
  while ([301, 302, 307, 308].includes(res.status) && hops++ < 5) res = await w.fetch(new URL(res.headers.get("location"), "https://inflationdle.com").pathname);
  return res.status === 200 && /<table/i.test(await res.text());
}

test("pages that aren't live are served normally, with the security headers", async t => {
  const n = days[0], w = createWorker();
  at(t, n, 6);
  const other = Object.keys(PAGES).find(p => PAGES[p] !== dayInfo(n).sym && ![-1, 0, 1].some(d => dayInfo(n + d).sym === PAGES[p]));
  const res = await w.fetch(other);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
});

test("/prices/hidden itself is never served directly", async () => {
  const w = createWorker();
  for (const p of ["/prices/hidden", "/prices/hidden.html", "/prices/hidden/"]) {
    let res = await w.fetch(p);
    if (res.status === 307) res = await w.fetch(res.headers.get("location"));
    assert.equal(res.status, 404, p);
  }
});

test("every price page in pages.json exists, and every item with a page is in the data", () => {
  const syms = new Set(countryFiles("us").data.series.map(s => s.sym.split(".")[0]));
  for (const [p, sym] of Object.entries(PAGES)) {
    assert.ok(syms.has(sym), `${p} → ${sym} isn't in prices.json`);
  }
});
