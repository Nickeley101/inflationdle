// Builds the daily X post: yesterday's answer as a 1200x675 card image plus the post text.
//   node scripts/daily-card.mjs            # today's post (yesterday's answer, today's teaser)
//   node scripts/daily-card.mjs --day 5    # the post that would go out on puzzle day 5
// Writes out/card.html, out/card.png and out/post.txt. Needs Playwright with Chromium for the PNG:
//   npm i --no-save playwright && npx playwright install chromium
import {readFileSync, writeFileSync, mkdirSync, rmSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});

// ---- Daily pick. Mirrors src/game.js; if the game's pick logic changes, change this too. ----
const {series: ALL} = JSON.parse(readFileSync(path.join(root, "data/prices.json"), "utf8"));
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SERIES = ALL.filter(s => (s.pts || s.v || []).filter(x => x != null).length >= 2);
SERIES.forEach(s => {
  if (!s.pts) s.pts = s.v.map((p, i) => [s.start + i, p]).filter(x => x[1] != null);
  s.last = s.pts[s.pts.length - 1];
  if (s.latest) { const [yy, mm] = s.latest.period.split("-").map(Number); s.now = {p: s.latest.value, label: MON[mm-1] + " " + yy, x: yy + (mm-1)/12}; }
  else s.now = {p: s.last[1], label: s.id ? "Jan " + s.last[0] : s.last[0] + "", x: s.last[0]};
});
const POOL = [];
SERIES.forEach((s, si) => s.pts.slice(0, -1).forEach(([y, p, name, date]) => POOL.push({si, y, p, name, date})));
// The day's round comes from data/schedule.json, like the game; a day it doesn't cover falls back to the game's shuffled order.
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const ORDER=(()=>{const r=rng(20260925),a=POOL.map((_,i)=>i);for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a})();
const SCHED = JSON.parse(readFileSync(path.join(root, "data/schedule.json"), "utf8")).days;
const key = r => SERIES[r.si].sym + ":" + r.y;
const pickDay = d => { const i = SCHED[d-1] ? POOL.findIndex(r => key(r) === SCHED[d-1]) : -1; return i >= 0 ? i : ORDER[(Math.max(1, d)-1) % ORDER.length]; };
// Mirrors market() in src/game.js.
const market = s => /U\.S\./.test(s.loc) ? s.loc : /^(South|West|Northeast|Midwest) /.test(s.loc) ? "U.S. " + s.loc : s.loc + ", US";
const pick = DAY => POOL[pickDay(DAY)];
// -----------------------------------------------------------------------------------------------

const EPOCH = Date.UTC(2026, 8, 25);
const argDay = process.argv.indexOf("--day");
const TODAY = argDay > 0 ? Number(process.argv[argDay+1]) : Math.floor((Date.now() - EPOCH) / 864e5) + 1;
if (!Number.isInteger(TODAY)) { console.error("Bad --day value."); process.exit(1); }
// Puzzle #1 has no earlier answer to reveal, so day 1 (or earlier) posts nothing.
if (TODAY < 2) { console.log("Nothing to reveal before puzzle day 2; no post today."); process.exit(0); }
const Y = TODAY - 1;

const fmt = p => "$" + (p < 1 ? p.toFixed(3).replace(/0$/, "") : p.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2}));
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const when = r => r.date || "January " + r.y;
const shortWhen = r => r.date ? r.date.replace(/^(\w{3})\w*/, "$1") : "Jan " + r.y;
const itemName = r => r.name || SERIES[r.si].name;

const ans = pick(Y), s = SERIES[ans.si], today = pick(TODAY), ts = SERIES[today.si];
const chg = (s.now.p / ans.p - 1) * 100;
// Mirrors nowLbl() in src/game.js.
const nowLbl = s => s.id ? "Price in " + s.now.label : s.cat === "Electronics" ? "Latest launch" : s.cat === "Cars" ? "Latest base price" : s.cat === "Subscriptions" || s.steps ? "Price now" : "Price in " + s.last[3].replace(/^(\w{3})\w*/, "$1");
const nowLabel = s.id ? s.now.label : nowLbl(s).replace(/^\w/, c => c.toLowerCase());

// Inflation fact, computed from official CPI (data/cpi.json), never written by hand.
const CPI = JSON.parse(readFileSync(path.join(root, "data/cpi.json"), "utf8"));
const FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthOf = d => { const m = /^(\w+) (\d{4})$/.exec(d || ""); const i = m ? FULL.indexOf(m[1]) : -1; return i < 0 ? null : [Number(m[2]), i]; };
function cpiAt([y, m]) {
  const [y0, m0] = CPI.start.split("-").map(Number), i = (y - y0) * 12 + (m - (m0 - 1));
  const at = k => CPI.v[Math.max(0, Math.min(k, CPI.v.length - 1))];
  if (i >= CPI.v.length) return at(CPI.v.length - 1);
  return at(i) ?? (at(i - 1) + at(i + 1)) / 2;  // BLS skipped Oct 2025; use the average of its neighbours
}
const thenYM = ans.date ? monthOf(ans.date) : [ans.y, 0];
const nowYM = s.latest ? [Number(s.latest.period.slice(0, 4)), Number(s.latest.period.slice(5)) - 1]
  : s.id ? [s.last[0], 0] : monthOf(s.last[3]);
const infl = thenYM && nowYM ? (cpiAt(nowYM) / cpiAt(thenYM) - 1) * 100 : null;
const real = infl == null ? null : ans.p * cpiAt(nowYM) / cpiAt(thenYM);
const pct = x => (x >= 0 ? "+" : "") + x.toFixed(0) + "%";
const lower = n => n.charAt(0).toLowerCase() + n.slice(1);
let fact = null, factShort = null;
if (infl != null) {
  const who = s.id ? s.name.split(",")[0] : s.who || "Console prices", gap = chg - infl;
  const verdict = chg < 0 ? "got cheaper" : Math.abs(gap) < 5 ? "went up about as much" : gap > 0 ? "went up faster" : "went up less";
  fact = `Prices overall rose ${infl.toFixed(0)}% in that time. ${who} ${verdict}.`;
  factShort = `Prices overall rose ${infl.toFixed(0)}% in that time.`;
}

// Chart: same shape as the in-game results chart.
function chart(W, H) {
  const L = 70, R = 20, T = 20, B = 34, pts = s.latest ? [...s.pts, [s.now.x, s.now.p]] : s.pts;
  const x0 = pts[0][0], x1 = pts[pts.length-1][0], ymax = Math.max(...pts.map(p => p[1])) * 1.1;
  const X = y => L + (y - x0) / (x1 - x0 || 1) * (W - L - R), Yp = v => T + (1 - v / ymax) * (H - T - B);
  const line = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Yp(p[1]).toFixed(1)).join("");
  const area = line + `L${X(x1).toFixed(1)} ${Yp(0)}L${X(x0).toFixed(1)} ${Yp(0)}Z`;
  // Cyan line with a soft glow, like the chart on the results screen.
  const col = "#4cc9f0";
  let g = "";
  // Gridlines at round prices ($2, $4, $6), like the video, rather than fractions of the top.
  const step = [.01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find(v => ymax / v <= 4) || 1e5;
  [...Array(Math.floor(ymax / step) + 1).keys()].map(i => i * step).forEach(v => { const yy = Yp(v); g += `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#233040"/><text x="${L-8}" y="${yy+5}" text-anchor="end">${v === 0 ? "$0" : v >= 10000 ? "$" + (v / 1000).toFixed(1) + "k" : v >= 100 || Number.isInteger(v) ? "$" + Math.round(v).toLocaleString("en-US") : "$" + v.toFixed(2)}</text>`; });
  g += `<text x="${X(x0)}" y="${H-8}">${x0}</text><text x="${X(x1)}" y="${H-8}" text-anchor="end">${Math.floor(x1)}</text>`;
  g += `<path d="${area}" fill="${col}" fill-opacity=".08"/><path d="${line}" fill="none" stroke="${col}" stroke-width="3" style="filter:drop-shadow(0 0 5px rgba(76,201,240,.5))"/>`;
  const px = X(ans.y), py = Yp(ans.p);
  g += `<line x1="${px}" x2="${px}" y1="${T}" y2="${H-B}" stroke="#f5b83d" stroke-dasharray="4 4"/><circle cx="${px}" cy="${py}" r="7" fill="#f5b83d"/>`;
  g += `<circle cx="${X(s.now.x)}" cy="${Yp(s.now.p)}" r="6" fill="${col}"/>`;
  return g;
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=JetBrains+Mono:wght@400;600;800&display=swap">
<style>
*{box-sizing:border-box}
body{margin:0;position:relative;width:1200px;height:675px;background:#0a0e13;color:#dbe4ee;font-family:"JetBrains Mono","DejaVu Sans Mono",monospace;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:baseline;padding:28px 44px 0}
.brand{font-family:"Barlow Condensed","DejaVu Sans",sans-serif;font-weight:800;font-size:44px;text-transform:uppercase}
.brand em{font-style:normal;color:#1fd67f;text-shadow:0 0 22px rgba(31,214,127,.5)}
.no{color:#7c8b9d;font-size:22px}
.item{padding:14px 44px 0;font-family:"Barlow Condensed","DejaVu Sans",sans-serif;font-weight:700;font-size:58px;line-height:1.05}
.meta{padding:6px 44px 0;color:#7c8b9d;font-size:22px}
.quote{padding:22px 44px 0;font-size:40px;font-weight:800;white-space:nowrap}
.quote small{font-size:22px;font-weight:600;color:#7c8b9d}
.quote .arr{color:#7c8b9d;font-weight:400}
.note{padding:14px 44px 0;font-size:21px;color:#aab6c3}
.quote .warm{text-shadow:0 0 18px rgba(245,184,61,.4)}
.warm{color:#f5b83d}.pos{color:#1fd67f}.neg{color:#ff4d5e}
svg{display:block;margin:10px 24px 0}
svg text{fill:#7c8b9d;font-size:16px;font-family:inherit}
.foot{position:absolute;left:44px;right:44px;bottom:22px;display:flex;justify-content:space-between;color:#7c8b9d;font-size:18px}
.foot b{color:#4cc9f0}
</style></head><body>
<div class="top"><div class="brand">Inflation<em>dle</em></div><div class="no">#${Y} ANSWER</div></div>
<div class="item">${esc(itemName(ans))}</div>
<div class="meta">${esc(s.unit)} · ${esc(market(s))} · ${esc(when(ans))}</div>
<div class="quote"><span class="warm">${fmt(ans.p)}</span> <small>${esc(shortWhen(ans))}</small> <span class="arr">→</span> ${fmt(s.now.p)} <small>${esc(nowLabel)}</small> <span class="${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "▲ +" : "▼ "}${chg.toFixed(0)}%</span></div>
${real == null ? "" : `<div class="note">${fmt(ans.p)} then is about ${fmt(real)} in today's money. Prices overall rose ${infl.toFixed(0)}%.</div>`}
<svg width="1152" height="290" viewBox="0 0 1152 290">${chart(1152, 290)}</svg>
<div class="foot"><span>${esc((s.id ? "Source: BLS average price" : s.src && s.srcShort ? "Source: " + s.srcShort : s.cat === "Subscriptions" ? "Source: published U.S. price" : s.cat === "Cars" ? "Source: automaker base MSRP" : s.cat === "Metals" ? "Source: World Bank Pink Sheet" : s.cat === "Fast food" ? "Source: The Economist's Big Mac index" : "Source: U.S. launch price (MSRP)") + (infl == null ? "" : ", CPI-U") + (s.id || infl != null ? ", via FRED" : ""))}</span><b>Play today's → inflationdle.com</b></div>
</body></html>`;
writeFileSync(path.join(out, "card.html"), html);

// No URL or bare domain in the text: X's API charges far more for posts with links (the card shows the site).
let text = [
  `Inflationdle #${Y} answer ${chg >= 0 ? "▲" : "▼"}`,
  `${itemName(ans)}, ${s.unit}`,
  `${market(s)} · ${shortWhen(ans)}: ${fmt(ans.p)}`,
  `${s.id ? s.now.label : nowLbl(s)}: ${fmt(s.now.p)} (${chg >= 0 ? "+" : ""}${chg.toFixed(0)}%)`,
  ...(fact ? [fact] : []),
  ``,
  `Today's #${TODAY}: ${itemName(today)}, ${market(ts)}, ${shortWhen(today)}. What did it cost?`,
  `Link in bio`,
].join("\n");
// X counts emoji and most symbols as 2 characters; stay under 280 by dropping the fact line if needed.
const xLen = t => [...t].reduce((n, c) => n + (c.codePointAt(0) > 0x2000 ? 2 : 1), 0);
if (xLen(text) > 280 && fact) text = text.replace(fact, factShort);
if (xLen(text) > 280 && fact) text = text.replace(factShort + "\n", "");
if (xLen(text) > 280) { console.error("Post text is " + xLen(text) + " characters, over X's 280 limit."); process.exit(1); }
writeFileSync(path.join(out, "post.txt"), text);

// Render with Playwright's Chromium (plain headless Chrome crops the bottom of the page).
// PLAYWRIGHT_MODULE lets a machine with a global Playwright install point at it.
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1200, height: 675}});
await page.goto("file://" + path.join(out, "card.html"));
await page.evaluate(() => document.fonts.ready);
await page.screenshot({path: path.join(out, "card.png")});
await browser.close();
console.log(text + "\n\n(" + xLen(text) + " characters as X counts them) → out/card.png, out/post.txt");
