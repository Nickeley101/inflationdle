// Plans the daily puzzle order and writes it to data/schedule.json, one round per day.
// The game and the X card read the day's round from that file, so adding or changing price data
// can never swap a puzzle that is already live or already teased on X.
//   node scripts/schedule.mjs            # after changing data/prices.json: re-plan the days not yet published
//   node scripts/schedule.mjs --check    # exit 1 if the file is out of date with the data (run on pull requests)
//   node scripts/schedule.mjs --keep 40  # re-plan from day 41 on (default: every day up to tomorrow stays fixed)
//   node scripts/schedule.mjs --country jp [--check]   # another country's daily: data/countries/jp.json in,
//                                        # data/countries/jp.schedule.json out; day 1 is the "epoch" in the country file
//
// U.S. from day 7 (Thursday 2026-10-01): a weekly pattern. Sunday dinner (meats), Monday groceries, Tuesday gas
// (every other week; electricity about once a quarter; groceries otherwise), Wednesday groceries, Thursday throwback
// (house, stamp, subway, gold, silver), Friday gadgets and cars (tech, cars, subscriptions, Big Mac), Saturday treats
// (beer, wine, ice cream, cookies, chips, strawberries, Big Mac). Big Mac rests 3 weeks between turns.
// See WEEK below. The era rules and the never-dealt-twice rule still apply.
// Rules for other countries (and the U.S. before day 7):
//   - Every 4th day is an Energy round (gas, electricity).
//   - The other days share out the remaining categories. Groceries fill most of them; each smaller category
//     (Electronics, and any new one such as Subscriptions) gets a steady share, from about one day in 12
//     up to one in 5 as it gains rounds, spaced evenly so it turns up regularly.
//   - Within a category, the item that has waited longest goes next, never the same item two days running,
//     and each item brings the round (year and place) that has waited longest.
//   - data/picks.json can hand-pick a round for a future day ({"9": "AAPL:2007"}); the plan works around it.
//   - A round (item and year, or item, place and year) is never dealt twice; a category that runs out hands its
//     days to the others. Other countries: once every round has been played, rounds come back oldest-played first.
//   - Older prices come first: rounds from 2010-2019 are rationed to about one day in 8 and rounds from 2020 on
//     to about one in 40. An item or category with nothing older still plays its newer rounds, and a category
//     that is mostly newer rounds (Subscriptions, Cars) gets fewer days.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const CHECK = process.argv.includes("--check");
const COUNTRY = arg("--country");
if (COUNTRY != null && !/^[a-z]{2}$/.test(COUNTRY)) { console.error("--country takes a two-letter code, like jp"); process.exit(1); }
const DATA_FILE = path.join(root, COUNTRY ? `data/countries/${COUNTRY}.json` : "data/prices.json");
const FILE = path.join(root, COUNTRY ? `data/countries/${COUNTRY}.schedule.json` : "data/schedule.json");
const DATA = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const EPOCH_STR = COUNTRY ? DATA.epoch : "2026-09-25";
const EPOCH = Date.parse(EPOCH_STR + "T00:00:00Z");   // puzzle #1, same as src/game.js
const YEAR = 365, MIN_DAYS = 730, AHEAD = 365;

// Rounds, built as in src/game.js: every point of every series except its latest one.
const {series: ALL} = DATA;
const SERIES = ALL.filter(s => (s.pts || s.v || []).filter(x => x != null).length >= 2);
const ROUNDS = new Map();
for (const s of SERIES) {
  const pts = s.pts || s.v.map((p, i) => [s.start + i, p]).filter(x => x[1] != null);
  for (const [y, p] of pts.slice(0, -1))
    ROUNDS.set(s.sym + ":" + y, {key: s.sym + ":" + y, cat: s.cat, item: s.line || s.name, p, era: y < 2010 ? 0 : y < 2020 ? 1 : 2});
}

// Tie-breaks come from a hash of the round's own key and the day, so they don't depend on what else is in the data.
// Other countries salt the tie-breaks with their code, so two countries' dailies don't start on the same item.
const SALT = COUNTRY ? "@" + COUNTRY : "";
const hash = str => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };

const byCat = {};
for (const r of ROUNDS.values()) ((byCat[r.cat] ??= {})[r.item] ??= []).push(r);
const count = c => Object.values(byCat[c]).reduce((n, a) => n + a.length, 0);
const oldShare = c => Object.values(byCat[c]).flat().filter(r => r.era === 0).length / count(c);
// U.S.: every 4th day is Energy (gas and electricity across many metros). Other countries have only a few
// energy items, so Energy takes a normal share of days there, like any other smaller category.
const ENERGY = !COUNTRY && "Energy" in byCat;
const isEnergyDay = d => ENERGY && d % 4 === 0;
const shared = Object.keys(byCat).filter(c => c !== "Energy" || !ENERGY).sort();
// The largest category takes whatever share the smaller ones leave.
const base = shared.reduce((a, c) => count(c) > count(a) ? c : a, shared[0]);
const rate = {};
for (const c of shared) if (c !== base) rate[c] = Math.min(1 / 5, Math.max(1 / 12, count(c) / (YEAR * 3 / 4)));
// Small categories (a couple of items, like Metals or the one-item Housing): keep each item to about one day a month.
for (const c of shared) if (c !== base) rate[c] = Math.min(rate[c], Object.keys(byCat[c]).length / 30);
for (const c of shared) if (c !== base) rate[c] *= 0.25 + 0.75 * oldShare(c);
rate[base] = Math.max(0, 1 - Object.values(rate).reduce((a, b) => a + b, 0));

const dayOf = t => Math.floor((t - EPOCH) / 864e5) + 1;
// Keep every day already live anywhere in the world (UTC+14 is first), plus the next one, which the X post teases.
// Days 1-4 were published before this file existed and are always kept.
const keep = arg("--keep") != null ? Number(arg("--keep")) : Math.max(COUNTRY ? 0 : 4, dayOf(Date.now() + 14 * 3600e3) + 1);
// Hand-picked days: data/picks.json for the U.S., the "picks" object inside a country's file for other countries.
const PICKS = COUNTRY ? DATA.picks || {} : existsSync(path.join(root, "data/picks.json")) ? JSON.parse(readFileSync(path.join(root, "data/picks.json"), "utf8")) : {};
for (const [d, k] of Object.entries(PICKS)) if (!ROUNDS.has(k)) console.warn(`data/picks.json: day ${d} names ${k}, which isn't a round; planning that day instead.`);
const old = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")).days : [];
const total = CHECK ? Math.max(MIN_DAYS, old.length) : Math.max(MIN_DAYS, keep + AHEAD);

// U.S. weekly pattern: each weekday deals from its own theme, with the fun stuff on Friday
// and Saturday. A theme lists categories, and optionally which of their items belong; days before WEEKLY_FROM
// keep the older rotation above. Each theme hands its day to the item that has waited longest.
const TREATS = /^(Beer|Table Wine|Ice Cream|Chocolate Chip Cookies|Potato Chips|Strawberries)$/;
const DINNER = /Steak|Roast|Chicken|Turkey|Ham|Pork|Bacon|Ground Beef|Bologna/;
const WEEK = [
  {name: "Sunday dinner", cats: {Groceries: DINNER}},
  {name: "Groceries", cats: {Groceries: x => !TREATS.test(x) && !DINNER.test(x)}},
  {name: "Gas & power", cats: {Energy: null}},
  {name: "Groceries", cats: {Groceries: x => !TREATS.test(x) && !DINNER.test(x)}},
  {name: "Throwback", cats: {Housing: null, Services: null, Metals: null}},
  {name: "Gadgets & cars", cats: {Electronics: null, Cars: null, Subscriptions: null, "Fast food": null}},
  {name: "Treats", cats: {Groceries: TREATS, "Fast food": null}},
];
// Days an item rests before its theme may deal it again. Big Mac would otherwise fill most
// Fridays and Saturdays. Pre-2010 electricity prices sit around 7-11 cents, inside the 2-cent win band, so it plays
// about once a quarter; gas every other Tuesday. A Tuesday with nothing rested goes to groceries (the next theme).
const REST = {"Fast food/U.S. Big Mac prices in The Economist's surveys": 21, "Energy/Electricity": 84, "Energy/Regular Gasoline": 14};
// Energy answers should not look alike week to week: skip rounds within 25% of that item's last answer when others are left.
const SPREAD = {Energy: .25};
const lastPrice = new Map();
const WEEKLY_FROM = COUNTRY ? Infinity : 7;          // day 7 = Thursday 2026-10-01
const weekday = d => (new Date(EPOCH + (d - 1) * 864e5)).getUTCDay();
const inTheme = (t, cat, item) => cat in t.cats && (t.cats[cat] == null || (typeof t.cats[cat] === "function" ? t.cats[cat](item) : t.cats[cat].test(item)));

const lastRound = new Map(), lastItem = new Map(), credit = Object.fromEntries(shared.map(c => [c, 0]));
// Newer rounds (2010-2019, 2020 on) earn a day's allowance slowly; a newer round spends one, even when it had to be played.
const ERA_RATE = [0, 1 / 8, 1 / 40], eraCredit = [0, 0, 0];
const allowed = r => r.era === 0 || eraCredit[r.era] >= 1;
let prevItem = null;
function tick() { for (let e = 1; e < 3; e++) eraCredit[e] = Math.min(1, eraCredit[e] + ERA_RATE[e]); }
function spend(r) { if (r.era) eraCredit[r.era] -= 1; }
function play(d, r) {
  tick();
  if (!isEnergyDay(d)) { for (const c of shared) credit[c] += rate[c]; if (r && r.cat in credit) credit[r.cat] -= 1; }
  if (!r) { prevItem = null; return; }
  spend(r);
  lastRound.set(r.key, d); lastItem.set(r.cat + "/" + r.item, d); prevItem = r.cat + "/" + r.item; lastPrice.set(prevItem, r.p);
}
const ago = (m, k) => m.has(k) ? m.get(k) : -Infinity;
function nextRound(items, d) {
  // Oldest round first; rounds never played tie, and the hash picks among them. Among rounds not played
  // within the last year, only older years (or a newer one with allowance to spare) are considered.
  return items.map(([item, rs]) => {
    // Other countries: an item's unplayed rounds all come before any of its rounds comes back.
    const unplayed = COUNTRY ? rs.filter(r => !lastRound.has(r.key)) : [], base = unplayed.length ? unplayed : rs;
    const fresh = base.filter(r => ago(lastRound, r.key) <= d - YEAR && allowed(r));
    const r = (fresh.length ? fresh : base).reduce((a, b) => {
      const da = ago(lastRound, a.key), db = ago(lastRound, b.key);
      return da !== db ? (da < db ? a : b) : hash(a.key + "@" + d + SALT) <= hash(b.key + "@" + d + SALT) ? a : b;
    });
    return {item, r, id: r.cat + "/" + item};
  });
}
function plan(d) {
  const picked = ROUNDS.get(PICKS[d]);
  if (picked) { play(d, picked); return picked.key; }
  tick();
  if (d >= WEEKLY_FROM) return planWeekly(d);
  let cat = "Energy";
  if (!isEnergyDay(d)) {
    for (const c of shared) credit[c] += rate[c];
    cat = shared.reduce((a, c) => credit[c] > credit[a] ? c : a);
  }
  const candsIn = c => nextRound(Object.entries(byCat[c] || {}), d)
    .filter(x => (x.id !== prevItem || Object.keys(byCat[c]).length === 1) && (!lastRound.has(x.r.key) || COUNTRY && lastRound.size >= ROUNDS.size));
  let cands = candsIn(cat);
  // A round is never dealt twice (other countries: until every round has been played). A category that has played
  // all its rounds hands the day to the next one in line.
  if (!cands.length) for (const c of [...shared].sort((a, b) => credit[b] - credit[a])) if ((cands = candsIn(c)).length) { cat = c; break; }
  // Other countries: items rest between turns (3 weeks, or 10 days for a pre-2010 round, since some countries have only
  // a few items with older prices), and each day goes to the category with the best rested round: an older price
  // first, then 2010-2019, then 2020 on. So a category whose items only have newer prices (Canada's groceries start
  // in 2017) hands its day to one with older rounds, and newer prices stay as rare there as they are in the U.S.
  const rested = x => ago(lastItem, x.id) <= d - (x.r.era ? 21 : 10);
  const rank = x => !rested(x) ? 9 : allowed(x.r) ? 0 : 1 + x.r.era, best = cs => Math.min(9, ...cs.map(rank));
  if (COUNTRY && best(cands) > 0)
    for (const c of [...shared].sort((a, b) => credit[b] - credit[a])) { const cs = candsIn(c); if (best(cs) < best(cands)) { cands = cs; cat = c; } }
  if (!cands.length) throw new Error(`Day ${d}: every round has been played; add price data or shorten the plan.`);
  if (cat in credit) credit[cat] -= 1;
  let ready = cands.filter(x => ago(lastRound, x.r.key) <= d - YEAR);
  const inEra = ready.filter(x => allowed(x.r));
  if (inEra.length) ready = inEra;
  let pool = ready.length ? ready : cands;
  if (COUNTRY && best(cands) < 9) {
    // Deal only among the rested items holding the best kind of round; with none rested, the plain rules above apply.
    const b = best(cands);
    pool = cands.filter(x => rank(x) === b); ready = ready.filter(x => pool.includes(x));
  }
  const firstBy = f => pool.reduce((a, b) => f(a) !== f(b) ? (f(a) < f(b) ? a : b) : hash(a.id + "@" + d + SALT) <= hash(b.id + "@" + d + SALT) ? a : b);
  const pick = ready.length ? firstBy(x => ago(lastItem, x.id)) : firstBy(x => ago(lastRound, x.r.key));
  spend(pick.r);
  lastRound.set(pick.r.key, d); lastItem.set(pick.id, d); prevItem = pick.id;
  return pick.r.key;
}

function planWeekly(d) {
  // A theme that has played every round hands its day to the next day's theme (Friday's gadgets run out first).
  let t, cands = [];
  for (let i = 0; i < 7 && !cands.length; i++) {
    t = WEEK[(weekday(d) + i) % 7];
    const items = Object.entries(byCat).flatMap(([c, is]) => Object.entries(is)
      .filter(([item]) => inTheme(t, c, item) && ago(lastItem, c + "/" + item) <= d - (REST[c + "/" + item] || 0))
      .map(([item, rs]) => {
        const last = lastPrice.get(c + "/" + item), far = SPREAD[c] && last != null ? rs.filter(r => !lastRound.has(r.key) && Math.abs(r.p / last - 1) >= SPREAD[c]) : [];
        return [item, far.length ? far : rs];
      }));
    cands = nextRound(items, d).filter(x => x.id !== prevItem && !lastRound.has(x.r.key));
  }
  if (!cands.length) throw new Error(`Day ${d}: the ${t.name} theme has played every round; add price data or widen it.`);
  const inEra = cands.filter(x => allowed(x.r));
  if (inEra.length) cands = inEra;
  const firstBy = f => cands.reduce((a, b) => f(a) !== f(b) ? (f(a) < f(b) ? a : b) : hash(a.id + "@" + d) <= hash(b.id + "@" + d) ? a : b);
  const pick = firstBy(x => ago(lastItem, x.id));
  spend(pick.r);
  lastRound.set(pick.r.key, d); lastItem.set(pick.id, d); prevItem = pick.id; lastPrice.set(pick.id, pick.r.p);
  return pick.r.key;
}

const days = [];
for (let d = 1; d <= total; d++) {
  if (d <= keep && old[d - 1]) { days.push(old[d - 1]); play(d, ROUNDS.get(old[d - 1])); }
  else days.push(plan(d));
}
const REL_DATA = path.relative(root, DATA_FILE), REL = path.relative(root, FILE), CMD = "node scripts/schedule.mjs" + (COUNTRY ? " --country " + COUNTRY : "");
const text = `{"epoch":"${EPOCH_STR}","days":[\n` + days.map(k => JSON.stringify(k)).join(",\n") + "\n]}\n";

const missing = days.slice(0, keep).filter(k => !ROUNDS.has(k));
if (missing.length) console.warn(`These published days name rounds no longer in ${REL_DATA}; the game falls back for them:`, missing.join(", "));
if (CHECK) {
  const today = dayOf(Date.now());
  if (!existsSync(FILE) || readFileSync(FILE, "utf8") !== text) {
    console.error(`${REL} is out of date with ${REL_DATA}. Run: ${CMD}`); process.exit(1);
  }
  if (old.length < today + 60) { console.error(`${REL} runs out within 60 days. Run: ${CMD}`); process.exit(1); }
  console.log(`${REL} is up to date through day ${old.length}.`);
} else {
  writeFileSync(FILE, text);
  console.log(`Wrote ${days.length} days; days 1-${Math.min(keep, old.length)} kept as published.`);
}
