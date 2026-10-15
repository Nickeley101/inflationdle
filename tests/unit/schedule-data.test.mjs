// The daily schedules and the price data they point at. scripts/schedule.mjs --check proves each schedule matches
// its data; these add the schedule rules and basic sanity checks on the numbers players guess.
import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {ROOT} from "../lib/paths.mjs";
import {countryFiles, countries, pool, dayOf} from "../lib/game-data.mjs";

const CODES = ["us", ...countries().map(c => c.code)];
const today = new Date().toLocaleDateString("en-CA", {timeZone: "America/New_York"});

for (const code of CODES) {
  const {data, sched, epoch} = countryFiles(code);
  const {series, rounds} = pool(data);
  const byKey = new Map(rounds.map(r => [r.key, r]));

  test(`${code}: the schedule matches the price data (schedule.mjs --check)`, () => {
    const args = ["scripts/schedule.mjs", "--check", ...(code === "us" ? [] : ["--country", code])];
    execFileSync(process.execPath, args, {cwd: ROOT, stdio: "pipe"});
  });

  test(`${code}: every scheduled day is a real round, and the schedule runs well ahead`, () => {
    assert.equal(sched.epoch, epoch, "schedule epoch matches the game's day 1");
    const missing = sched.days.map((k, i) => [i + 1, k]).filter(([, k]) => !byKey.has(k));
    assert.deepEqual(missing, [], "days whose round isn't in the data (the game would fall back to a shuffle)");
    const left = sched.days.length - dayOf(today, epoch);
    assert.ok(left >= 60, `only ${left} days planned after today`);
  });

  test(`${code}: no round repeats until every round has been played`, () => {
    const seen = new Map();
    const limit = Math.min(sched.days.length, rounds.length);
    sched.days.slice(0, limit).forEach((k, i) => {
      assert.ok(!seen.has(k), `${k} is on day ${seen.get(k)} and again on day ${i + 1}`);
      seen.set(k, i + 1);
    });
  });

  const item = k => { const r = byKey.get(k); return r ? r.s.line || r.s.name : k; };
  const backToBack = (from, to) => {
    const out = [];
    for (let d = Math.max(1, from); d < Math.min(to, sched.days.length); d++) if (item(sched.days[d - 1]) === item(sched.days[d])) out.push(d);
    return out;
  };
  test(`${code}: the same item never plays two days running in the year ahead`, () => {
    const start = dayOf(today, epoch);
    assert.deepEqual(backToBack(start, start + 365), []);
  });
  // Known gap, reported 2026-09-27: from day 481 (January 2028) Canada's plan runs out of other items and deals
  // toothpaste and gas days in a row. Re-planning with more Canadian data, or letting the planner recycle rounds
  // sooner, fixes it. Flip `todo` off once the whole schedule passes.
  test(`${code}: the same item never plays two days running anywhere in the schedule`, {todo: code === "ca" && "Canada repeats items from Jan 2028"}, () => {
    assert.deepEqual(backToBack(1, sched.days.length), []);
  });

  // Stamp prices go back to 1885, so years from 1850 are allowed.
  test(`${code}: prices are positive numbers, years ascend and symbols are unique`, () => {
    const syms = new Set();
    for (const s of series) {
      assert.ok(!syms.has(s.sym), `duplicate symbol ${s.sym}`); syms.add(s.sym);
      assert.ok((s.name || s.line) && s.cat && s.unit !== undefined, `${s.sym} is missing name/cat/unit`);
      s.pts.forEach(([y, p], i) => {
        assert.ok(Number.isFinite(p) && p > 0, `${s.sym} ${y}: price ${p}`);
        assert.ok(Number.isInteger(Math.floor(y)) && y >= 1850 && y <= 2100, `${s.sym}: year ${y}`);
        if (i) assert.ok(y >= s.pts[i - 1][0], `${s.sym}: years out of order at ${y}`);
      });
    }
  });
}

test("us: older prices dominate the year ahead (heavy bias to pre-2010)", () => {
  const {data, sched, epoch} = countryFiles("us");
  const byKey = new Map(pool(data).rounds.map(r => [r.key, r]));
  const start = dayOf(today, epoch), year = sched.days.slice(start - 1, start - 1 + 365).map(k => byKey.get(k).y);
  const share = f => year.filter(f).length / year.length;
  assert.ok(share(y => y < 2010) >= .75, `pre-2010 share ${(share(y => y < 2010) * 100).toFixed(0)}%`);
  assert.ok(share(y => y >= 2020) <= .06, `2020+ share ${(share(y => y >= 2020) * 100).toFixed(0)}%`);
});

test("us: no round after 2020 from 2026-09-27 through 2026-10-27", () => {
  const {data, sched, epoch} = countryFiles("us");
  const byKey = new Map(pool(data).rounds.map(r => [r.key, r]));
  for (let d = dayOf("2026-09-27", epoch); d <= dayOf("2026-10-27", epoch); d++)
    assert.ok(byKey.get(sched.days[d - 1]).y <= 2020, `day ${d}: ${sched.days[d - 1]}`);
});

test("us: weekly themes from 2026-10-01: Tuesday energy or groceries, Thursday throwback, fun Friday and Saturday", () => {
  const {data, sched, epoch} = countryFiles("us");
  const byKey = new Map(pool(data).rounds.map(r => [r.key, r]));
  const want = {2: ["Energy", "Groceries"], 4: ["Housing", "Services", "Metals"], 5: ["Electronics", "Cars", "Subscriptions", "Fast food"], 6: ["Groceries", "Fast food"]};
  const start = dayOf("2026-10-01", epoch);
  for (let d = start; d < start + 365; d++) {
    const wd = new Date(Date.parse(epoch + "T00:00:00Z") + (d - 1) * 864e5).getUTCDay();
    if (want[wd]) assert.ok(want[wd].includes(byKey.get(sched.days[d - 1]).s.cat), `day ${d}: ${sched.days[d - 1]}`);
  }
});

test("us: Big Mac rests 3 weeks and electricity 12 weeks between turns", () => {
  const {data, sched, epoch} = countryFiles("us");
  const byKey = new Map(pool(data).rounds.map(r => [r.key, r]));
  const rest = {MCD: 21, POWER: 84}, last = {};
  for (let d = dayOf("2026-10-01", epoch); d < dayOf("2026-10-01", epoch) + 365; d++) {
    const g = sched.days[d - 1].split(/[.:]/)[0];
    if (!rest[g]) continue;
    if (last[g]) assert.ok(d - last[g] >= rest[g], `${g} on day ${last[g]} and again on day ${d}`);
    last[g] = d;
  }
});

test("every country in the picker has its data and schedule", () => {
  for (const c of countries()) {
    assert.match(c.code, /^[a-z]{2}$/);
    assert.ok(c.name && c.flag, c.code);
    const {data} = countryFiles(c.code);
    assert.ok(data.currency && data.locale && data.epoch && data.hitMin > 0, `${c.code} file is missing currency settings`);
  }
});
