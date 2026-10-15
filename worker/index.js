// Live visitor counter for inflationdle.com.
// A visitor counts once per day, where days run midnight to midnight U.S. Eastern time. To tell repeat visits apart without cookies, the Worker hashes
// IP + browser with a random salt that exists only for that day; salts and hashes are deleted after a day,
// so a hash can't be linked back to anyone or across days (the same approach as Plausible).
//
// D1 tables (created once by hand, see worker/schema.sql):
//   totals(id=1, visitors)   running total since launch
//   days(day, visitors)      per-day count, for "+N today"
//   salts(day, salt)         today's random salt
//   seen(day, h)             salted hashes of today's visitors (and "ref:<src>:<hash>" for tagged links)
//   refs(day, src, visitors) visitors per day from each tagged link (created by the Worker on first use)

const CACHE_SECONDS = 10;

// YYYY-MM-DD in New York (handles daylight saving).
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const json = (body, extra = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });

async function counts(db, day) {
  const row = await db
    .prepare("SELECT (SELECT visitors FROM totals WHERE id = 1) AS total, (SELECT visitors FROM days WHERE day = ?1) AS today")
    .bind(day)
    .first();
  return { total: row?.total ?? 0, today: row?.today ?? 0 };
}

async function daySalt(db, day) {
  const fresh = crypto.randomUUID();
  const ins = await db.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?1, ?2)").bind(day, fresh).run();
  if (ins.meta.changes) {
    // First visitor of a new day: forget older salts and hashes.
    await db.batch([
      db.prepare("DELETE FROM salts WHERE day < ?1").bind(day),
      db.prepare("DELETE FROM seen WHERE day < ?1").bind(day),
    ]);
    return fresh;
  }
  const row = await db.prepare("SELECT salt FROM salts WHERE day = ?1").bind(day).first();
  return row.salt;
}

// Today's salted hash of this browser (IP + user agent); unreadable after the day's salt is deleted.
async function visitorHash(request, db, day) {
  const salt = await daySalt(db, day);
  const who = `${salt}|${request.headers.get("cf-connecting-ip") || ""}|${request.headers.get("user-agent") || ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(who));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hit(request, env) {
  const db = env.DB;
  const day = today();
  const h = await visitorHash(request, db, day);

  const ins = await db.prepare("INSERT OR IGNORE INTO seen (day, h) VALUES (?1, ?2)").bind(day, h).run();
  if (ins.meta.changes) {
    await db.batch([
      db.prepare("UPDATE totals SET visitors = visitors + 1 WHERE id = 1"),
      db.prepare("INSERT INTO days (day, visitors) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET visitors = visitors + 1").bind(day),
    ]);
  }
  return json(await counts(db, day));
}

// ---- where visitors come from -----------------------------------------------------------------------------------
// Profile and post links carry ?ref=<source> (inflationdle.com/?ref=tiktok). In-app browsers often drop the referrer,
// so the page reports the tag here instead; it's counted once per browser, source and day, like the counter.
//   refs(day, src, visitors)
const SOURCES = new Set(["tiktok", "yt", "bsky", "x", "ig", "fb", "threads", "reddit", "kofi", "email", "qr"]);
let refsReady = false;

async function ref(request, env) {
  const src = new URL(request.url).searchParams.get("src") || "";
  if (!SOURCES.has(src)) return json({ error: "unknown source" }, {}, 400);
  const db = env.DB;
  if (!refsReady) {
    await db.prepare("CREATE TABLE IF NOT EXISTS refs (day TEXT NOT NULL, src TEXT NOT NULL, visitors INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src))").run();
    refsReady = true;
  }
  const day = today();
  const h = await visitorHash(request, db, day);
  const ins = await db.prepare("INSERT OR IGNORE INTO seen (day, h) VALUES (?1, ?2)").bind(day, `ref:${src}:${h}`).run();
  if (ins.meta.changes) {
    await db.prepare("INSERT INTO refs (day, src, visitors) VALUES (?1, ?2, 1) ON CONFLICT(day, src) DO UPDATE SET visitors = visitors + 1").bind(day, src).run();
  }
  return json({ ok: true });
}

async function read(request, env, ctx) {
  // Everyone polls this, so share one D1 read per data center every few seconds.
  const cache = caches.default;
  const key = new Request(new URL("/api/visitors", request.url).toString());
  const cached = await cache.match(key);
  if (cached) return cached;
  const res = json(await counts(env.DB, today()), { "cache-control": `public, max-age=${CACHE_SECONDS}` });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---- price history pages -------------------------------------------------------------------------------------
// Rule: while an item's daily round is live, its price pages are hidden completely and its row leaves the
// /prices/ index. A day's round is live from when UTC+14 starts the day (10:00 UTC the day before) until UTC-12
// finishes it (12:00 UTC the day after), the same window the game and the answer posts use.
const DAY_MS = 864e5;

async function asset(env, request, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  return res.ok ? res.json() : null;
}

// Items (base symbol, e.g. "GAS" for "GAS.CHI:1995") with a live round now, each with when its last live round ends.
// A player who has finished every live round of an item (day numbers the game keeps in the ic_done cookie) sees it.
function liveItems(sched, now, done = new Set()) {
  const epoch = Date.parse(sched.epoch + "T00:00:00Z"), live = new Map(), todo = new Set();
  sched.days.forEach((k, i) => {
    const start = epoch + i * DAY_MS - 14 * 36e5, end = epoch + (i + 1) * DAY_MS + 12 * 36e5;
    const sym = k.split(":")[0].split(".")[0];
    if (now < start || now >= end) return;
    live.set(sym, Math.max(live.get(sym) || 0, end));
    if (!done.has(i + 1)) todo.add(sym);
  });
  for (const sym of live.keys()) if (!todo.has(sym)) live.delete(sym);
  return live;
}
const doneDays = (request) => new Set(((request.headers.get("cookie") || "").match(/(?:^|;\s*)ic_done=([\d.]+)/)?.[1] || "").split(".").filter(Boolean).map(Number));

const endsText = (t) =>
  "on " + new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) + " Eastern";

async function pricePage(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const [sched, pages] = await Promise.all([asset(env, request, "/data/schedule.json"), asset(env, request, "/prices/pages.json")]);
  if (!sched || !pages) return res;
  const live = liveItems(sched, Date.now(), doneDays(request));
  const path = new URL(request.url).pathname.replace(/\.html$/, "").replace(/\/index$/, "/").replace(/(.)\/$/, "$1");
  const headers = new Headers(res.headers);
  // What a visitor sees depends on their ic_done cookie, so no shared cache may keep it.
  headers.set("cache-control", "private, no-cache");
  if (path === "/prices") {
    let html = await res.text();
    for (const sym of live.keys()) html = html.replace(new RegExp(`<tr data-sym="${sym}">.*?</tr>`, "g"), "");
    // City pages (gas and electricity by metro) are listed as links under their item; drop the live item's links,
    // then any separators and headings those removals leave empty.
    for (const [p, sym] of Object.entries(pages)) if (live.has(sym)) html = html.replace(new RegExp(`<a href="${p}(?:\\.html)?">[^<]*</a>`, "g"), "");
    html = html.replace(/(?: · )+(?=<\/p>)/g, "").replace(/(<p class="rel">)(?: · )+/g, "$1").replace(/(?: · ){2,}/g, " · ")
      .replace(/<h3>[^<]*<\/h3><p class="rel"><\/p>/g, "")
      // A category whose only item is live (Fast food while the Big Mac is up) loses its heading and empty table too.
      .replace(/<h2>[^<]*<\/h2><table[^>]*><thead>.*?<\/thead><tbody><\/tbody><\/table>/g, "");
    return new Response(html, { status: 200, headers });
  }
  if (path === "/prices/hidden") return new Response("Not found", { status: 404 });
  const sym = pages[path];
  if (!sym || !live.has(sym)) return new Response(res.body, { status: res.status, headers });
  // 503 with Retry-After tells search engines the page is only away for now, so it keeps its place in results.
  const hidden = await env.ASSETS.fetch(new Request(new URL("/prices/hidden", request.url)));
  const html = (await hidden.text()).replace("{{ENDS}}", endsText(live.get(sym)));
  headers.set("cache-control", "no-store");
  headers.set("retry-after", String(Math.max(60, Math.ceil((live.get(sym) - Date.now()) / 1000))));
  return new Response(html, { status: 503, headers });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/api/visitors" && request.method === "GET") return await read(request, env, ctx);
      if (pathname === "/api/visitors" && request.method === "POST") return await hit(request, env);
      if (pathname === "/api/ref" && request.method === "POST") return await ref(request, env);
    } catch (err) {
      console.error(err);
      return json({ error: "counter unavailable" }, {}, 503);
    }
    if (pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    if (pathname === "/prices" || pathname.startsWith("/prices/")) return pricePage(request, env);
    return env.ASSETS.fetch(request);
  },
};
