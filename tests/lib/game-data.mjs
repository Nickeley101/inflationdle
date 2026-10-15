// Reads the game's data the way src/game.js does, so tests know each day's round and its answer without
// reaching into the page. Keep in step with the POOL/roundOf logic in src/game.js.
import {readFileSync} from "node:fs";
import {ROOT} from "./paths.mjs";

const json = f => JSON.parse(readFileSync(`${ROOT}/${f}`, "utf8"));
export const US_EPOCH = "2026-09-25";

export function countryFiles(code = "us") {
  return code === "us"
    ? {data: json("data/prices.json"), sched: json("data/schedule.json"), epoch: US_EPOCH}
    : (d => ({data: d, sched: json(`data/countries/${code}.schedule.json`), epoch: d.epoch}))(json(`data/countries/${code}.json`));
}
export const countries = () => json("data/countries/index.json");

export function pool(data) {
  const series = data.series.filter(s => (s.pts || s.v || []).filter(x => x != null).length >= 2).map(s => ({
    ...s, pts: s.pts || s.v.map((p, i) => [s.start + i, p]).filter(x => x[1] != null),
  }));
  const rounds = [];
  series.forEach(s => s.pts.slice(0, -1).forEach(([y, p, name, date]) => rounds.push({s, sym: s.sym, key: s.sym + ":" + y, y, p, name, date})));
  return {series, rounds};
}

// Day number for a calendar date (YYYY-MM-DD, the player's local date), as in dayNumber() in src/game.js.
export const dayOf = (ymd, epoch) => Math.floor((Date.parse(ymd + "T00:00:00Z") - Date.parse(epoch + "T00:00:00Z")) / 864e5) + 1;

// The round a date plays, or null when the schedule doesn't cover it.
export function roundFor(ymd, code = "us") {
  const {data, sched, epoch} = countryFiles(code);
  const day = dayOf(ymd, epoch), k = sched.days[day - 1];
  const r = pool(data).rounds.find(x => x.key === k);
  return r ? {...r, day, data} : null;
}

// Prices the grader counts as a hit / close, from src/game.js (5% or the floor; 25% or the floor).
export const floors = code => code === "us" ? {hit: .02, warm: .05, decimals: 2} : (d => ({hit: d.hitMin, warm: d.warmMin, decimals: d.decimals ?? 2}))(countryFiles(code).data);
export const isHit = (g, p, code = "us") => Math.abs(g - p) <= Math.max(.05 * p, floors(code).hit) + 1e-9;

// A bid string that wins on the first try: the answer rounded to what the input accepts.
export function winningBid(r, code = "us") {
  const d = floors(code).decimals;
  return (Math.round(r.p * 10 ** d) / 10 ** d).toFixed(d);
}
// Six bids that all miss and all stay inside the allowed range: each lower than the last, all far above the answer.
export function losingBids(r, code = "us") {
  const d = floors(code).decimals, step = Math.max(r.p, floors(code).warm * 10, d ? 1 : 10);
  return [12, 11, 10, 9, 8, 7].map(k => (Math.ceil((r.p + step * k) * 10 ** d) / 10 ** d).toFixed(d));
}

// Items with a live daily round at time `now` (ms), by base symbol, using the same window as worker/index.js:
// from 10:00 UTC the day before (UTC+14 midnight) to 12:00 UTC the day after (UTC-12 end of day).
export function liveSyms(now = Date.now()) {
  const {sched} = countryFiles("us"), epoch = Date.parse(sched.epoch + "T00:00:00Z"), live = new Set();
  sched.days.forEach((k, i) => {
    const start = epoch + i * 864e5 - 14 * 36e5, end = epoch + (i + 1) * 864e5 + 12 * 36e5;
    if (now >= start && now < end) live.add(k.split(":")[0].split(".")[0]);
  });
  return live;
}
export const pricePages = () => json("prices/pages.json");
// A price page that is hidden right now, or null when no live item has one.
export function liveHiddenPath(now = Date.now()) {
  const live = liveSyms(now);
  return Object.entries(pricePages()).find(([, sym]) => live.has(sym))?.[0] ?? null;
}
// The first price page matching `re` whose item is not live right now, so a test can expect it to load.
export function shownPricePage(re, now = Date.now()) {
  const live = liveSyms(now);
  return Object.entries(pricePages()).find(([path, sym]) => re.test(path) && !live.has(sym))?.[0] ?? null;
}
