// Refreshes the BLS Average Price series in data/prices.json, and adds the
// metro and regional series listed in data/metros.json.
// Usage: node scripts/update-prices.mjs            (reads FRED's copy of each BLS series, no key needed)
//        BLS_API_KEY=... node scripts/update-prices.mjs   (reads the BLS API directly)
// FRED republishes BLS Average Price data unchanged under the same series ids.
// Keyless BLS access is capped at 25 requests/day per IP and is often used up, hence FRED as the default.
// Free BLS key: https://data.bls.gov/registrationEngine/
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../data/prices.json", import.meta.url);
const METROS = new URL("../data/metros.json", import.meta.url);
const KEY = process.env.BLS_API_KEY;
const FIRST = 1976;
const LAST = new Date().getFullYear();

const data = JSON.parse(await readFile(FILE, "utf8"));
const metros = JSON.parse(await readFile(METROS, "utf8"));

// Add a placeholder for every area/item pair not already present.
const known = new Set(data.series.map((s) => s.id).filter(Boolean));
for (const it of metros.items) {
  for (const a of metros.areas.filter((a) => it.areas.includes(a.kind))) {
    const id = `APU${a.code}${it.item}`;
    if (known.has(id)) continue;
    data.series.push({ cat: it.cat, id, sym: `${it.sym}.${a.tag}`, name: it.name, unit: it.unit, loc: a.name, start: null, v: [] });
  }
}

const bls = data.series.filter((s) => s.id);
// monthly[id]["YYYY-MM"] = value
const monthly = Object.fromEntries(bls.map((s) => [s.id, {}]));
// `prior`: an older BLS series id for the same product (BLS renumbers items now and then); its Januaries fill
// the years the current id doesn't cover. Always read from FRED.
for (const s of bls) if (s.prior) monthly[s.prior] = {};

async function fromBls(ids) {
  for (let start = FIRST; start <= LAST; start += 20) {
    const body = { seriesid: ids, startyear: String(start), endyear: String(Math.min(start + 19, LAST)), registrationkey: KEY };
    const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS: ${json.status} ${json.message}`);
    for (const s of json.Results.series)
      for (const row of s.data)
        if (row.value !== "-" && /^M(0[1-9]|1[0-2])$/.test(row.period)) monthly[s.seriesID][`${row.year}-${row.period.slice(1)}`] = Number(row.value);
  }
}

async function fromFred(id) {
  // FRED's CDN resets requests with Node's default or a browser-like User-Agent; an identifying one gets through.
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { headers: { "User-Agent": "inflationdle-price-refresh (github.com/Nickeley101/inflationdle)" } });
  if (res.status === 404) return; // not published
  if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`);
  for (const line of (await res.text()).trim().split("\n").slice(1)) {
    const [date, value] = line.split(",");
    if (value && value !== ".") monthly[id][date.slice(0, 7)] = Number(value);
  }
}

if (KEY) for (let i = 0; i < bls.length; i += 50) await fromBls(bls.slice(i, i + 50).map((s) => s.id));
else for (const s of bls) await fromFred(s.id);
for (const s of bls) if (s.prior) await fromFred(s.prior);

let changed = 0;
const drop = new Set();
for (const s of bls) {
  const m = monthly[s.id];
  const jan = {};
  for (const [p, v] of Object.entries(m)) if (p.endsWith("-01")) jan[+p.slice(0, 4)] = v;
  if (s.prior) for (const [p, v] of Object.entries(monthly[s.prior])) if (p.endsWith("-01")) jan[+p.slice(0, 4)] ??= v;
  const years = Object.keys(jan).map(Number).sort((a, b) => a - b);
  const period = Object.keys(m).sort().at(-1);
  if (years.length < 2 || (s.start == null && !s.ended && +period.slice(0, 4) < LAST - 2)) {
    if (s.start == null) drop.add(s); // area/item pair BLS doesn't publish, or has stopped publishing
    else console.warn(`No data for ${s.id}, left as is`);
    continue;
  }
  // Charts join the dots, so a long hole in BLS's record draws a misleading straight line: keep only the
  // years after the last gap of 5+ years, and drop a line left with fewer than 6 Januaries. A line joined to
  // its `prior` series keeps the hole between the two (kept on purpose for butter).
  let first = 0;
  if (!s.prior) for (let i = 1; i < years.length; i++) if (years[i] - years[i - 1] >= 5) first = i;
  if (years.length - first < 6) { drop.add(s); continue; }
  years.splice(0, first);
  const v = [];
  for (let y = years[0]; y <= years.at(-1); y++) v.push(jan[y] ?? null);
  const diffs = v.filter((x, i) => x !== (s.v[i + years[0] - s.start] ?? null)).length;
  if (diffs || s.start !== years[0]) { changed++; console.log(`${s.id} ${s.sym}: ${diffs} value(s) updated`); }
  s.start = years[0];
  s.v = v;
  // Newest monthly value, so the "now" price matches what BLS and FRED show as current.
  s.latest = { period, value: m[period] };
}
data.series = data.series.filter((s) => !drop.has(s));

await writeFile(FILE, JSON.stringify(data, null, 1) + "\n");
console.log(`Done. ${changed} series changed, ${drop.size} unpublished area/item pairs skipped.`);
