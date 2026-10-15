// Picks the item and hook for the daily spotlight video (promo/spotlight.html, the 16:00 UTC post).
// Every third day is one of the favorites (beer, gas, steak, coffee...); the other days go through every other U.S. item
// with a long, current price history: national and regional groceries, gas by city and region, electricity by region,
// silver, gadgets and cars, each kind spread evenly. Each time an item comes back it gets its next hook, so the same
// video doesn't repeat: a favorite returns about every six weeks, any other item about every four months.
//   node scripts/spotlight-picks.mjs [days]   # the coming days' picks (default 30), skipping live rounds' items
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

// Day 12 (2026-10-06) was the first spotlight (beer), the first favorite.
const START = 12;

const BORN = "the year you were born", HS = "the year you graduated high school", JOB = "the year you got your first job",
  OUT = "the year you moved out", T21 = "the year you turned 21", LIC = "the year you got your license",
  CAR = "the year you bought your first car", APT = "the year you got your first apartment";
const DEFAULT = [BORN, HS, JOB, OUT];

// [screen name, noun for the question, hooks]. Items not listed here aren't used.
const ITEMS = {
  BEER: ["Beer", "beer", [T21, JOB, OUT, BORN]], WINE: ["Wine", "wine", [T21, OUT, JOB, BORN]],
  GAS: ["Gas", "gas", [LIC, CAR, BORN, HS]], POWER: ["Electricity", "electricity", [APT, OUT, BORN]],
  STEAK: ["Steak", "steak"], COFFEE: ["Coffee", "coffee", ["the year you started drinking coffee", BORN, JOB, HS]],
  EGGS: ["Eggs", "eggs"], BACON: ["Bacon", "bacon"], ICECRM: ["Ice cream", "ice cream"], BEEF: ["Ground beef", "ground beef"],
  CHIPS: ["Potato chips", "chips"], COOKIE: ["Cookies", "cookies"], MILK: ["Milk", "milk"], BREAD: ["Bread", "bread"],
  BANANA: ["Bananas", "bananas"], CHKN: ["Chicken breast", "chicken breast"], BUTTER: ["Butter", "butter"],
  SUGAR: ["Sugar", "sugar"], FLOUR: ["Flour", "flour"], RICE: ["Rice", "rice"], WCHKN: ["Whole chicken", "a whole chicken"],
  CHEDR: ["Cheddar", "cheddar"], ORANGE: ["Oranges", "oranges"], POTATO: ["Potatoes", "potatoes"], LETTUCE: ["Lettuce", "lettuce"],
  TOMATO: ["Tomatoes", "tomatoes"], OJ: ["Frozen OJ", "frozen OJ"], LEMON: ["Lemons", "lemons"], WHEAT: ["Wheat bread", "wheat bread"],
  PORK: ["Pork chops", "pork chops"], PASTA: ["Pasta", "pasta"], AMCHS: ["American cheese", "American cheese"], HAM: ["Ham", "ham"],
  ROAST: ["Chuck roast", "chuck roast"], STRAW: ["Strawberries", "strawberries"],
  HOUSE: ["New house", "a new house", [BORN, "the year you bought your first home", JOB]],
  MCD: ["Big Mac", "a Big Mac", [JOB, BORN, HS]], GOLD: ["Gold", "an ounce of gold", [BORN, HS, JOB]],
  SILVER: ["Silver", "an ounce of silver", [BORN, HS, JOB]],
  AAPL: ["iPhone", "an iPhone", ["the year you got your first iPhone", HS, OUT]], IPAD: ["iPad", "an iPad", ["the year you got your first one", HS, OUT]],
  MBAIR: ["MacBook Air", "a MacBook Air", ["the year you started college", "the year you got your first one", OUT]],
  AWATCH: ["Apple Watch", "an Apple Watch", ["the year you got your first one", HS, OUT]],
  KINDLE: ["Kindle", "a Kindle", ["the year you got your first one", HS, OUT]], GOPRO: ["GoPro", "a GoPro", ["the year you got your first one", HS, OUT]],
  CIVIC: ["Honda Civic", "a Honda Civic", [CAR, LIC, HS]], ACCORD: ["Honda Accord", "a Honda Accord", [CAR, LIC, HS]],
  CRV: ["Honda CR-V", "a Honda CR-V", [CAR, LIC, HS]],
};
// Sources for items that aren't BLS averages (the video and caption name them).
const SOURCES = {HOUSE: "Census & HUD median new-home price via FRED", MCD: "The Economist's Big Mac index",
  GOLD: "World Bank commodity prices", SILVER: "World Bank commodity prices"};
// Groups spread through the cycle; the national favorites go first in this order.
const FAVORITES = ["BEER", "GAS", "STEAK", "COFFEE", "HOUSE", "BACON", "MCD", "WINE", "EGGS", "ICECRM", "BEEF", "CHIPS", "GOLD", "COOKIE"];
const group = s => FAVORITES.includes(s.sym) ? 0 : s.pts ? 1 : /^U\.S\./.test(s.loc) ? 2 : s.sym.startsWith("GAS.") ? 3 : s.sym.startsWith("POWER.") ? 4 : 5;

// "Boston area" → "in Boston", "Northeast (urban)" → "in the Northeast", "Urban Hawaii" → "in Hawaii".
export const placeOf = loc => /^(U\.S\.|World)/.test(loc) ? "" : / area$/.test(loc) ? "in " + loc.replace(/ area$/, "")
  : /^Urban /.test(loc) ? "in " + loc.slice(6) : "in the " + loc.replace(" (urban)", "");

// Items with at least 10 years and 8 prices since 1975, still current (BLS: a price within the last year; others: within two).
// Returns the two streams: the favorites in order, and everything else with each kind spread evenly.
export function topics(series, thisYear = new Date().getUTCFullYear()) {
  const ok = series.filter(s => {
    const base = s.sym.split(".")[0];
    if (!ITEMS[base] || s.practice || s.ended || s.steps) return false;
    if (s.pts) { const p = s.pts.filter(r => r[0] >= 1975); return p.length >= 8 && p.at(-1)[0] - p[0][0] >= 10 && p.at(-1)[0] >= thisYear - 2; }
    const first = Math.max(1975, s.start), n = s.v.slice(first - s.start).filter(v => v != null).length;
    return n >= 10 && s.latest && +s.latest.period.slice(0, 4) >= thisYear - 1;
  });
  const fav = FAVORITES.map(k => ok.find(s => s.sym === k)).filter(Boolean);
  // An item's slot is its place within its kind as a fraction of the cycle, so no kind bunches up.
  const groups = [1, 2, 3, 4, 5].map(g => ok.filter(s => group(s) === g).sort((a, b) => hash(a.sym) - hash(b.sym)));
  const rest = groups.flatMap((g, gi) => g.map((s, i) => ({s, at: (i + 0.5) / g.length, gi})))
    .sort((a, b) => a.at - b.at || a.gi - b.gi).map(x => x.s);
  return {fav, rest};
}
// A stable shuffle order that doesn't depend on the list's order in prices.json.
function hash(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }

// Items in a round still being played on puzzle day y: that day's and the next day's (the next goes live 10:00 UTC).
const liveOn = (days, y) => new Set(days.slice(Math.max(0, y - 1), y + 1).map(k => k.split(":")[0].split(".")[0]));

// The pick for puzzle day `day`, given the schedule's `days`. Replays the rotation from the start so no item and hook
// pair repeats until every pair in its list has been used: a live round's item gives its day to the next unused pair.
export function spotlightPick(series, days, day, thisYear) {
  const {fav, rest} = topics(series, thisYear), used = [new Set(), new Set()], recent = [[], []];
  let week = [];  // the base items (GAS for GAS.CHI) of the last six days, so the same kind of item doesn't come back within a week
  let pick;
  for (let y = START; y <= Math.max(START, day); y++) {
    const d = y - START, third = Math.floor(d / 3), f = d % 3 === 0 ? 0 : 1, list = f ? rest : fav;
    const k = f ? third * 2 + d % 3 - 1 : third, L = list.length, live = liveOn(days, y);
    const total = list.reduce((n, s) => n + (ITEMS[s.sym.split(".")[0]][2] || DEFAULT).length, 0);
    if (used[f].size >= total) used[f].clear();
    // When the spacing rules leave nothing unused, the half-list rule goes first; then the list starts over early
    // (every pair counts as unused again) rather than breaking the week rule, which goes only as the last resort.
    pick = null;
    for (const [pass, fresh] of [[0], [1], [0, true], [1], [2]]) for (let j = 0; !pick && j < L; j++) {
      if (fresh && j === 0) used[f].clear();
      const s = list[(k + j) % L], base = s.sym.split(".")[0];
      // Skip live rounds' items, items shown within the last half of the list, and kinds shown in the last six days.
      if (live.has(base) || pass < 1 && recent[f].includes(s.sym) || pass !== 2 && week.includes(base)) continue;
      const hooks = ITEMS[base][2] || DEFAULT, cycle = Math.floor((k + j) / L);
      for (let h = 0; !pick && h < hooks.length; h++) {
        const hook = hooks[(cycle + h) % hooks.length];
        if (!used[f].has(s.sym + "|" + hook)) pick = {s, hook};
      }
    }
    if (!pick) throw new Error(`No spotlight pick for day ${y}.`);
    used[f].add(pick.s.sym + "|" + pick.hook);
    recent[f] = [...recent[f], pick.s.sym].slice(-Math.floor(L / 2));
    week = [...week, pick.s.sym.split(".")[0]].slice(-6);
  }
  const {s, hook} = pick, base = s.sym.split(".")[0], [name, noun] = ITEMS[base], place = placeOf(s.loc);
  return {sym: s.sym, name, place, src: SOURCES[base] || (s.pts ? s.who || s.src : null),
    hook: `What did ${noun} cost${place ? " " + place : ""} ${hook}?`,
    cta: "Comment " + hook.replace(/^the year you were born$/, "your birth year"), when: hook};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const {series} = JSON.parse(readFileSync(path.join(root, "data/prices.json"), "utf8"));
  const {days} = JSON.parse(readFileSync(path.join(root, "data/schedule.json"), "utf8"));
  const EPOCH = Date.UTC(2026, 8, 25), today = Math.floor((Date.now() - EPOCH) / 864e5) + 1, n = +process.argv[2] || 30;
  const {fav, rest} = topics(series);
  console.log(`${fav.length} favorites and ${rest.length} other items in the rotation.`);
  for (let y = today; y < today + n; y++) {
    const p = spotlightPick(series, days, y);
    console.log(new Date(EPOCH + (y - 1) * 864e5).toISOString().slice(0, 10), p.sym.padEnd(9), p.hook);
  }
}
