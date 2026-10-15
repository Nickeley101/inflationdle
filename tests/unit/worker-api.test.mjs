// The visitor counter API (/api/visitors in worker/index.js): counting, privacy, caching and bad input.
import {test} from "node:test";
import assert from "node:assert/strict";
import {createWorker} from "../lib/worker-env.mjs";
import {createD1} from "../lib/d1.mjs";

const post = (w, ip = "203.0.113.7", ua = "Mozilla/5.0 test") =>
  w.fetch("/api/visitors", {method: "POST", headers: {"cf-connecting-ip": ip, "user-agent": ua}});
const get = w => w.fetch("/api/visitors");

test("GET returns the counts as JSON without counting anyone", async () => {
  const w = createWorker();
  const res = await get(w);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await res.json(), {total: 0, today: 0});
  assert.equal(w.env.DB.raw.prepare("SELECT COUNT(*) n FROM seen").get().n, 0);
});

test("POST counts a browser once per day", async () => {
  const w = createWorker();
  assert.deepEqual(await (await post(w)).json(), {total: 1, today: 1});
  assert.deepEqual(await (await post(w)).json(), {total: 1, today: 1});
  assert.deepEqual(await (await post(w, "198.51.100.2")).json(), {total: 2, today: 2});
  const res = await post(w);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("no IP address or user agent is stored, only a salted hash", async () => {
  const w = createWorker();
  await post(w, "203.0.113.99", "SecretAgent/1.0");
  const dump = JSON.stringify([...w.env.DB.raw.prepare("SELECT * FROM seen").all(), ...w.env.DB.raw.prepare("SELECT * FROM salts").all()]);
  assert.doesNotMatch(dump, /203\.0\.113\.99|SecretAgent/);
  const {h} = w.env.DB.raw.prepare("SELECT h FROM seen").get();
  assert.match(h, /^[0-9a-f]{24}$/);
});

test("a new day starts a new salt and forgets yesterday's hashes", async t => {
  const w = createWorker();
  t.mock.timers.enable({apis: ["Date"], now: Date.parse("2026-10-01T15:00:00Z")});
  await post(w);
  t.mock.timers.setTime(Date.parse("2026-10-02T15:00:00Z"));
  assert.deepEqual(await (await post(w)).json(), {total: 2, today: 1});
  const db = w.env.DB.raw;
  assert.deepEqual(db.prepare("SELECT day FROM salts").all().map(r => r.day), ["2026-10-02"]);
  assert.deepEqual(db.prepare("SELECT DISTINCT day FROM seen").all().map(r => r.day), ["2026-10-02"]);
});

test("the day rolls over at midnight New York time, not UTC", async t => {
  const w = createWorker();
  t.mock.timers.enable({apis: ["Date"], now: Date.parse("2026-10-02T03:30:00Z")}); // 23:30 in New York on Oct 1
  await post(w);
  t.mock.timers.setTime(Date.parse("2026-10-02T03:59:00Z"));
  assert.deepEqual(await (await post(w)).json(), {total: 1, today: 1}, "still Oct 1 in New York");
  t.mock.timers.setTime(Date.parse("2026-10-02T04:01:00Z"));
  assert.deepEqual(await (await post(w)).json(), {total: 2, today: 1}, "a new day in New York");
});

test("GET is cached briefly so polling doesn't hammer the database", async () => {
  const w = createWorker();
  const first = await get(w);
  assert.match(first.headers.get("cache-control"), /max-age=\d+/);
  await post(w);
  assert.deepEqual(await (await get(w)).json(), {total: 0, today: 0}, "served from cache");
  w.cache.clear();
  assert.deepEqual(await (await get(w)).json(), {total: 1, today: 1});
});

test("other methods and unknown API paths are 404s", async () => {
  const w = createWorker();
  for (const method of ["PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const res = await w.fetch("/api/visitors", {method});
    assert.equal(res.status, 404, method);
  }
  for (const p of ["/api/", "/api/visitors/1", "/api/admin", "/api/visitors.json", "/api/../api/visitors%00"]) {
    const res = await w.fetch(p, {method: "POST"});
    assert.equal(res.status, 404, p);
  }
  assert.equal(w.env.DB.raw.prepare("SELECT visitors FROM totals").get().visitors, 0, "nothing was counted");
});

test("a POST body, query string or odd headers can't change what is counted", async () => {
  const w = createWorker();
  const res = await w.fetch("/api/visitors?total=999999&today=5", {
    method: "POST",
    headers: {"content-type": "application/json", "cf-connecting-ip": "1.2.3.4", "user-agent": "x'); DROP TABLE totals;--"},
    body: JSON.stringify({total: 999999, today: 999999}),
  });
  assert.deepEqual(await res.json(), {total: 1, today: 1});
  const huge = await post(w, "1.2.3.4", "A".repeat(64 * 1024));
  assert.equal(huge.status, 200);
  const none = await w.fetch("/api/visitors", {method: "POST"}); // no IP or user agent at all
  assert.equal(none.status, 200);
  assert.equal(w.env.DB.raw.prepare("SELECT COUNT(*) n FROM totals").get().n, 1, "tables intact");
});

test("a database outage answers 503 without leaking details", async () => {
  const w = createWorker({db: createD1({failWith: new Error("D1_ERROR: secret internal detail")})});
  const orig = console.error; console.error = () => {};
  try {
    for (const method of ["GET", "POST"]) {
      const res = await w.fetch("/api/visitors", {method});
      assert.equal(res.status, 503);
      const body = await res.text();
      assert.doesNotMatch(body, /secret|D1_ERROR|stack/i);
      assert.deepEqual(JSON.parse(body), {error: "counter unavailable"});
    }
  } finally { console.error = orig; }
});

// Known gap, reported 2026-09-27: every new IP + browser pair counts as a new visitor, so one script that varies
// its user agent can run the counter up without limit (and use up D1's free daily writes). A Cloudflare rate-limit
// rule on POST /api/visitors, or a per-IP cap in the Worker, would close it. Flip `todo` off once it's fixed.
test("one IP can't inflate the counter by changing its user agent", {todo: "no per-IP limit yet"}, async () => {
  const w = createWorker();
  for (let i = 0; i < 50; i++) await post(w, "203.0.113.50", "bot/" + i);
  const {total} = await (await get(w)).json();
  assert.ok(total <= 5, `one IP counted ${total} times`);
});

// ---- tagged links (?ref=<source>) --------------------------------------------------------------------------------
const ref = (w, src, ip = "203.0.113.7", ua = "Mozilla/5.0 test") =>
  w.fetch(`/api/ref?src=${src}`, {method: "POST", headers: {"cf-connecting-ip": ip, "user-agent": ua}});
const refRows = w => w.env.DB.raw.prepare("SELECT src, visitors FROM refs ORDER BY src").all().map(r => ({...r}));

test("a tagged link counts once per browser, source and day, without touching the visitor counter", async () => {
  const w = createWorker();
  assert.equal((await ref(w, "tiktok")).status, 200);
  await ref(w, "tiktok");
  await ref(w, "tiktok", "198.51.100.9");
  await ref(w, "bsky");
  assert.deepEqual(refRows(w), [{src: "bsky", visitors: 1}, {src: "tiktok", visitors: 2}]);
  assert.deepEqual(await (await get(w)).json(), {total: 0, today: 0}, "the odometer doesn't move");
  const seen = w.env.DB.raw.prepare("SELECT h FROM seen").all().map(r => r.h);
  assert.ok(seen.every(h => /^ref:[a-z]+:[0-9a-f]{24}$/.test(h)), "only salted hashes are stored");
});

test("unknown or malformed sources are refused and nothing is stored", async () => {
  const w = createWorker();
  for (const src of ["", "evil", "TIKTOK", "tiktok%27", "x;drop", "a".repeat(40)]) assert.equal((await ref(w, src)).status, 400, src);
  assert.equal((await w.fetch("/api/ref?src=tiktok")).status, 404, "GET isn't an endpoint");
  assert.equal(w.env.DB.raw.prepare("SELECT COUNT(*) n FROM seen").get().n, 0);
});
