// Weekly stats report: site visits, visitor counter, Bluesky, YouTube and dle directory listings.
// Runs on GitHub (weekly-report.yml), which can reach these sites. Writes out/report.md, prints it to the log and
// adds it to the run's summary page. Each section is optional: a missing key or a failed request becomes a line
// saying so, never a failed job.
//
// Keys (repo secrets):
//   CF_API_TOKEN   Cloudflare API token with "Account Analytics: Read" (Web Analytics) and "D1: Read" (counter)
//   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN   the same YouTube keys the video post uses. With the
//                  yt-analytics.readonly scope on the token (the YouTube and Drive setup notes), it also lists each Short's
//                  average view length and how much of it people watched.
// X isn't included: reading X stats through its API costs money per request.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const ACCOUNT = process.env.CF_ACCOUNT_ID || "0fa9cae2d2cdd71c6615825e8a0e1df4";
const COUNTER_DB = "9c585776-cc67-4dde-8b99-cc203bd5a880";
const BSKY = "inflationdle.bsky.social";
const DAYS = 7;
const DIRECTORIES = [
  ["The Dles", ["https://dles.aukspot.com/"]],
  ["Seekdle", ["https://seekdle.com/", "https://seekdle.com/?q=inflationdle", "https://seekdle.com/search?q=inflationdle"]],
  ["Dle List", ["https://dlelist.com/", "https://dlelist.com/?s=inflationdle", "https://dlelist.com/search?q=inflationdle"]],
  ["dailydle.org", ["https://dailydle.org/", "https://dailydle.org/?s=inflationdle"]],
  ["Listdle", ["https://listdle.com/", "https://listdle.com/?q=inflationdle", "https://listdle.com/search?q=inflationdle"]],
];

const day = d => d.toISOString().slice(0, 10);
const now = new Date(), from = new Date(now - DAYS * 864e5);
const n = x => Number(x || 0).toLocaleString("en-US");
const out = [`# Inflationdle weekly report`, ``, `${day(from)} to ${day(now)} (UTC)`, ``];
const section = (title, lines) => out.push(`## ${title}`, ``, ...lines, ``);
const fail = e => `Couldn't read this: ${String(e.message || e).slice(0, 200)}`;

const UA = "Mozilla/5.0 (compatible; InflationdleWeeklyReport/1.0; +https://inflationdle.com)";
async function json(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...opts.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${new URL(url).host} → ${res.status} ${JSON.stringify(body.errors || body.error || body).slice(0, 150)}`);
  return body;
}
const cf = (path, body) => json(`https://api.cloudflare.com/client/v4${path}`, {
  method: body ? "POST" : "GET", body: body && JSON.stringify(body),
  headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
});

// ---- Cloudflare Web Analytics ---------------------------------------------------------------------------------
async function webAnalytics() {
  if (!process.env.CF_API_TOKEN) return ["No CF_API_TOKEN secret yet, so there are no Web Analytics numbers."];
  const group = dims => `rumPageloadEventsAdaptiveGroups(limit: 10, filter: {date_geq: $from, date_leq: $to}, orderBy: [count_DESC]) { count sum { visits } dimensions { ${dims} } }`;
  const q = `query($acc: String!, $from: Date!, $to: Date!) { viewer { accounts(filter: {accountTag: $acc}) {
    total: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {date_geq: $from, date_leq: $to}) { count sum { visits } }
    byDay: rumPageloadEventsAdaptiveGroups(limit: 10, filter: {date_geq: $from, date_leq: $to}, orderBy: [date_ASC]) { count sum { visits } dimensions { date } }
    refs: ${group("refererHost")}
    countries: ${group("countryName")}
    pages: ${group("requestPath")}
  } } }`;
  const r = await cf("/graphql", { query: q, variables: { acc: ACCOUNT, from: day(from), to: day(now) } });
  if (r.errors?.length) throw new Error(r.errors[0].message);
  const a = r.data.viewer.accounts[0];
  const t = a.total[0] || { count: 0, sum: { visits: 0 } };
  const list = (rows, key, blank) => rows.map(x => `${x.dimensions[key] || blank} ${n(x.count)}`).join(", ") || "none";
  return [
    `- Visits: **${n(t.sum.visits)}**, page views: **${n(t.count)}**`,
    `- By day (visits): ${a.byDay.map(x => `${x.dimensions.date.slice(5)} ${n(x.sum.visits)}`).join(", ") || "none"}`,
    `- Where visitors came from (page views): ${list(a.refs, "refererHost", "direct or unknown")}`,
    `- Countries: ${list(a.countries, "countryName", "unknown")}`,
    `- Top pages: ${list(a.pages, "requestPath", "?")}`,
  ];
}

// ---- visitor counter (D1) -------------------------------------------------------------------------------------
async function counter() {
  if (!process.env.CF_API_TOKEN) {
    const r = await json("https://inflationdle.com/api/visitors");
    return [`- Total on the counter: **${n(r.total)}** (today: ${n(r.today)}). Add CF_API_TOKEN for day-by-day numbers.`];
  }
  const r = await cf(`/accounts/${ACCOUNT}/d1/database/${COUNTER_DB}/query`, {
    sql: "SELECT (SELECT visitors FROM totals WHERE id = 1) AS total, (SELECT group_concat(day || ' ' || visitors, ', ') FROM (SELECT day, visitors FROM days WHERE day >= ?1 ORDER BY day)) AS days, (SELECT sum(visitors) FROM days WHERE day >= ?1) AS week",
    params: [day(from)],
  });
  const row = r.result[0].results[0];
  // Tagged profile/post links (?ref=tiktok etc.); the table appears once the first tagged visit arrives.
  const refs = await cf(`/accounts/${ACCOUNT}/d1/database/${COUNTER_DB}/query`, {
    sql: "SELECT src, sum(visitors) AS v FROM refs WHERE day >= ?1 GROUP BY src ORDER BY v DESC", params: [day(from)],
  }).then(x => x.result[0].results.map(y => `${y.src} ${n(y.v)}`).join(", ") || "none yet", () => "none yet");
  return [`- Total on the counter: **${n(row.total)}**`, `- Visitors this week: **${n(row.week)}** (${row.days || "none"}; one per browser per day)`,
    `- From tagged links this week: ${refs}`];
}

// ---- Bluesky --------------------------------------------------------------------------------------------------
async function bluesky() {
  const api = "https://public.api.bsky.app/xrpc/";
  const p = await json(`${api}app.bsky.actor.getProfile?actor=${BSKY}`);
  const feed = await json(`${api}app.bsky.feed.getAuthorFeed?actor=${BSKY}&limit=50&filter=posts_no_replies`);
  const week = feed.feed.map(f => f.post).filter(x => new Date(x.indexedAt) >= from);
  const sum = k => week.reduce((s, x) => s + (x[k] || 0), 0);
  const best = week.slice().sort((a, b) => (b.likeCount + b.repostCount) - (a.likeCount + a.repostCount))[0];
  return [
    `- Followers: **${n(p.followersCount)}** (posts all time: ${n(p.postsCount)})`,
    `- This week: ${week.length} posts, ${n(sum("likeCount"))} likes, ${n(sum("repostCount"))} reposts, ${n(sum("replyCount"))} replies`,
    ...(best ? [`- Best post: "${(best.record.text || "").split("\n")[0].slice(0, 80)}" (${best.likeCount} likes, ${best.repostCount} reposts)`] : []),
  ];
}

// ---- YouTube --------------------------------------------------------------------------------------------------
async function youtube() {
  if (!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN)) return ["No YouTube keys in this run."];
  const tok = await json("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", client_id: process.env.YT_CLIENT_ID, client_secret: process.env.YT_CLIENT_SECRET, refresh_token: process.env.YT_REFRESH_TOKEN }) });
  const auth = { headers: { Authorization: "Bearer " + tok.access_token } };
  const yt = p => json("https://www.googleapis.com/youtube/v3/" + p, auth);
  const ch = (await yt("channels?part=statistics,contentDetails&mine=true")).items[0];
  const list = await yt(`playlistItems?part=contentDetails&maxResults=25&playlistId=${ch.contentDetails.relatedPlaylists.uploads}`);
  const ids = list.items.map(i => i.contentDetails.videoId);
  const vids = ids.length ? (await yt(`videos?part=statistics,snippet,status&id=${ids.join(",")}`)).items : [];
  const week = vids.filter(v => new Date(v.snippet.publishedAt) >= from);
  const views = week.reduce((s, v) => s + Number(v.statistics.viewCount || 0), 0);
  const top = vids.slice().sort((a, b) => b.statistics.viewCount - a.statistics.viewCount)[0];
  const priv = vids.filter(v => v.status.privacyStatus !== "public").length;
  // Watch time per Short (YouTube Analytics API; needs the yt-analytics.readonly scope). Analytics lag about two days.
  const watched = new Map();
  let note = "";
  try {
    const r = await json("https://youtubeanalytics.googleapis.com/v2/reports?" + new URLSearchParams({ ids: "channel==MINE",
      startDate: day(new Date(now - 28 * 864e5)), endDate: day(now), dimensions: "video", sort: "-views", maxResults: "50",
      metrics: "views,averageViewDuration,averageViewPercentage,likes,subscribersGained" }), auth);
    for (const [id, v, dur, pct, likes, subs] of r.rows || []) watched.set(id, { v, dur, pct, likes, subs });
  } catch (e) {
    note = /\b(401|403)\b/.test(e.message)
      ? "Watch time per Short needs the YouTube token to allow analytics (the yt-analytics.readonly scope; see the YouTube and Drive setup notes)."
      : fail(e);
  }
  // Every Short from the week, newest first: views, likes and, with analytics, how much of it people watched.
  const kind = t => /vs today/i.test(t) ? "evening" : /every year since/i.test(t) ? "spotlight" : /Today's puzzle/i.test(t) ? "teaser" : "answer";
  const rows = week.map(v => {
    const a = watched.get(v.id), sec = a ? `${Math.round(a.dur)} s, ${Math.round(a.pct)}%` : "";
    return `| ${v.snippet.publishedAt.slice(5, 16).replace("T", " ")} | ${kind(v.snippet.title)} | [${v.snippet.title.replace(/ #shorts$/, "").replace(/\|/g, "/").slice(0, 60)}](https://youtube.com/shorts/${v.id}) | ${n(v.statistics.viewCount)} | ${n(v.statistics.likeCount)} | ${sec}${v.status.privacyStatus !== "public" ? " (" + v.status.privacyStatus + ")" : ""} |`;
  });
  const zero = week.filter(v => !Number(v.statistics.viewCount)).length;
  return [
    `- Subscribers: **${n(ch.statistics.subscriberCount)}**, channel views all time: ${n(ch.statistics.viewCount)}`,
    `- This week: ${week.length} Shorts, ${n(views)} views on them${zero ? `; ${zero} still at 0 views` : ""}`,
    ...(top ? [`- Most viewed Short: "${top.snippet.title.slice(0, 70)}" with ${n(top.statistics.viewCount)} views (https://youtube.com/shorts/${top.id})`] : []),
    ...(priv ? [`- ${priv} of the latest ${vids.length} Shorts aren't public.`] : []),
    ...(note ? [`- ${note}`] : []),
    ...(rows.length ? [``, `| Posted (UTC) | Type | Short | Views | Likes | Avg watched (28 days) |`, `|---|---|---|---|---|---|`, ...rows] : []),
  ];
}

// ---- dle directories ------------------------------------------------------------------------------------------
async function directories() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const lines = [];
  for (const [name, urls] of DIRECTORIES) {
    let found = null, reached = 0, err = "";
    for (const url of urls) {
      const page = await browser.newPage();
      try {
        const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        if (res && res.ok()) reached++;
        for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 4000); await page.waitForTimeout(400) } // load lazy lists
        // A search page echoes the query, so there only a link to the game counts.
        const hit = await page.evaluate(isSearch => [...document.querySelectorAll("a[href]")].some(a => /inflationdle\.com/i.test(a.href)) ||
          (!isSearch && /inflationdle/i.test(document.body.innerText)), url.includes("?"));
        if (hit) { found = url; break }
      } catch (e) { err = e.message.split("\n")[0] } finally { await page.close() }
    }
    if (!found && name === "The Dles" && process.env.GH_TOKEN) {
      // The Dles lists games from its GitHub repo, so search there too.
      try {
        const r = await json("https://api.github.com/search/code?q=inflationdle+repo:aukspot/dles", { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` } });
        if (r.total_count) found = `github.com/aukspot/dles (${r.items[0].path})`;
      } catch (e) { err = err || e.message }
    }
    lines.push(found ? `- ${name}: **listed** (found on ${found})`
      : reached ? `- ${name}: not found on ${urls.join(", ")}. It may still be in review, or on a page this check doesn't open.`
      : `- ${name}: couldn't open the site (${err.slice(0, 80) || "no response"})`);
  }
  await browser.close();
  return lines;
}

for (const [title, fn] of [["Site visits (Cloudflare Web Analytics)", webAnalytics], ["Visitor counter", counter],
  ["Bluesky", bluesky], ["YouTube", youtube], ["Dle directories", directories]]) {
  try { section(title, await fn()) } catch (e) { section(title, [fail(e)]) }
}
out.push("X and TikTok numbers aren't included. Check them in each app.");

const md = out.join("\n") + "\n";
mkdirSync("out", { recursive: true });
writeFileSync("out/report.md", md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
