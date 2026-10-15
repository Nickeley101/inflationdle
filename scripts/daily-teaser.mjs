// Builds the daily "today's puzzle" teaser: today's item, place and date as a 1200x675 card, with no price.
//   node scripts/daily-teaser.mjs            # today's teaser
//   node scripts/daily-teaser.mjs --day 5    # the teaser for puzzle day 5
// Writes out/card.html, out/card.png and out/post.txt, the same files scripts/daily-card.mjs writes,
// so post-to-x.mjs posts it unchanged. Nothing on it hints at the price.
// Needs Playwright with Chromium for the PNG.
import {readFileSync, writeFileSync, mkdirSync, rmSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});

const EPOCH = Date.UTC(2026, 8, 25);
const argDay = process.argv.indexOf("--day");
const TODAY = argDay > 0 ? Number(process.argv[argDay + 1]) : Math.floor((Date.now() - EPOCH) / 864e5) + 1;
if (!Number.isInteger(TODAY) || TODAY < 1) { console.error("Bad --day value."); process.exit(1); }
const key = JSON.parse(readFileSync(path.join(root, "data/schedule.json"), "utf8")).days[TODAY - 1];
if (!key) { console.error(`data/schedule.json has no round for day ${TODAY}.`); process.exit(1); }

const [sym, yearStr] = key.split(":"), year = Number(yearStr);
const {series} = JSON.parse(readFileSync(path.join(root, "data/prices.json"), "utf8"));
const s = series.find(x => x.sym === sym);
const row = s?.pts ? s.pts.find(p => p[0] === year) : null;
if (!s || (s.pts ? !row : s.v?.[year - s.start] == null)) { console.error(`No price for ${key}.`); process.exit(1); }
// Mirror scripts/daily-card.mjs (itemName, when, shortWhen) and market() in src/game.js.
const item = row?.[2] || s.name;
const when = row?.[3] || "January " + year;
const shortWhen = when.replace(/^(\w{3})\w*/, "$1");
const market = /U\.S\./.test(s.loc) ? s.loc : /^(South|West|Northeast|Midwest) /.test(s.loc) ? "U.S. " + s.loc : s.loc + ", US";
// Some units already name the market (Big Mac: "one burger, U.S. price"), so don't repeat it.
const place = s.unit.includes(market) ? [] : [market];
const esc = x => String(x).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=JetBrains+Mono:wght@400;600;800&display=swap">
<style>
*{box-sizing:border-box}
body{margin:0;position:relative;width:1200px;height:675px;background:#0a0e13;color:#dbe4ee;font-family:"JetBrains Mono","DejaVu Sans Mono",monospace;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:baseline;padding:28px 44px 0}
.brand{font-family:"Barlow Condensed","DejaVu Sans",sans-serif;font-weight:800;font-size:44px;text-transform:uppercase}
.brand em{font-style:normal;color:#1fd67f;text-shadow:0 0 22px rgba(31,214,127,.5)}
.yr{color:#4cc9f0;text-shadow:0 0 18px rgba(76,201,240,.4)}
.no{color:#7c8b9d;font-size:22px}
.item{padding:44px 44px 0;font-family:"Barlow Condensed","DejaVu Sans",sans-serif;font-weight:700;font-size:78px;line-height:1.02}
.meta{padding:10px 44px 0;color:#7c8b9d;font-size:26px}
.q{display:flex;align-items:center;gap:34px;padding:44px 44px 0}
.box{border:2px solid #f5b83d;border-radius:10px;padding:14px 30px;font-size:64px;font-weight:800;color:#f5b83d;letter-spacing:.06em}
.ask{font-size:26px;line-height:1.5}
.ask span{color:#7c8b9d}
.slots{display:flex;gap:14px;padding:46px 44px 0}
.slots div{flex:1;height:58px;border:1px solid #233040;border-radius:8px;color:#3a4a5c;font-size:22px;display:flex;align-items:center;padding-left:16px}
.foot{position:absolute;left:44px;right:44px;bottom:22px;display:flex;justify-content:space-between;color:#7c8b9d;font-size:18px}
.foot b{color:#4cc9f0}
</style></head><body>
<div class="top"><div class="brand">Inflation<em>dle</em></div><div class="no">#${TODAY} TODAY'S PUZZLE</div></div>
<div class="item">${esc(item)}</div>
<div class="meta">${[s.unit, ...place].map(esc).join(" · ")} · <span class="yr">${esc(when)}</span></div>
<div class="q"><div class="box">$ ? ? ?</div><div class="ask">What did it cost?<br><span>6 guesses. Get within 5% to win.</span></div></div>
<div class="slots">${[1, 2, 3, 4, 5, 6].map(n => `<div>${n}</div>`).join("")}</div>
<div class="foot"><span>Answer posted tomorrow</span><b>Play today's → inflationdle.com</b></div>
</body></html>`;
writeFileSync(path.join(out, "card.html"), html);

// No URL or bare domain in the text: X's API charges far more for posts with links (the card shows the site).
// post-to-bluesky.mjs turns the last line into a link.
const text = [
  `Inflationdle #${TODAY}`,
  `${item}, ${s.unit}`,
  [...place, shortWhen].join(" · "),
  ``,
  `What did it cost? 6 guesses, get within 5%.`,
  `Link in bio`,
].join("\n");
const xLen = t => [...t].reduce((n, c) => n + (c.codePointAt(0) > 0x2000 ? 2 : 1), 0);
if (xLen(text) > 280) { console.error("Post text is " + xLen(text) + " characters, over X's 280 limit."); process.exit(1); }
writeFileSync(path.join(out, "post.txt"), text);

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1200, height: 675}});
await page.goto("file://" + path.join(out, "card.html"));
await page.evaluate(() => document.fonts.ready);
await page.screenshot({path: path.join(out, "card.png")});
await browser.close();
console.log(text + "\n\n(" + xLen(text) + " characters as X counts them) → out/card.png, out/post.txt");
