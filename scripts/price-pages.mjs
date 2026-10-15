// Builds the price history pages at /prices/ (one page per item, plus one per city for gas and electricity)
// from data/prices.json, data/cpi.json and data/schedule.json, and adds them to sitemap.xml.
//
//   node scripts/price-pages.mjs
//
// Re-run it after any price data or schedule change and commit prices/ and sitemap.xml.
//
// Spoilers rule: while an item's daily round is live, from when UTC+14 starts the day (10:00 UTC the
// day before) until UTC-12 finishes it (12:00 UTC the day after), the item's pages are hidden completely and its row
// leaves the /prices/ index. worker/index.js does that on each request, using prices/pages.json (written here) and
// data/schedule.json, so the pages themselves hold every price and never need a rebuild to lock or unlock.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const SITE = "https://inflationdle.com";
const DATA = JSON.parse(readFileSync("data/prices.json", "utf8"));
const CPI = JSON.parse(readFileSync("data/cpi.json", "utf8"));
const NOW = Date.now();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---- CPI -----------------------------------------------------------------------------------------------------
const [cy0, cm0] = CPI.start.split("-").map(Number);
const cpiAt = (y, m) => { const v = CPI.v[(y - cy0) * 12 + (m - 1) - (cm0 - 1)]; return v == null ? null : v };
const cpiLastI = CPI.v.findLastIndex(v => v != null);
const CPI_NOW = CPI.v[cpiLastI];
const cpiNowLabel = MON[(cm0 - 1 + cpiLastI) % 12] + " " + (cy0 + Math.floor((cm0 - 1 + cpiLastI) / 12));

// ---- formatting (same as the game) ---------------------------------------------------------------------------
const fmt = p => "$" + (p < 1 ? p.toFixed(3) : p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cents = p => "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (a, b) => Math.round((b / a - 1) * 100);
const signed = n => (n >= 0 ? "+" : "−") + Math.abs(n).toLocaleString("en-US") + "%";

// ---- pages ---------------------------------------------------------------------------------------------------
// [slug, name used in "<name> prices by year", short noun for sentences]
const PAGES = {
  EGGS: ["eggs", "Egg", "a dozen Grade A large eggs"], MILK: ["milk", "Milk", "a gallon of whole milk"],
  BREAD: ["bread", "Bread", "a pound of white bread"], BEEF: ["ground-beef", "Ground Beef", "a pound of ground beef"],
  COFFEE: ["coffee", "Coffee", "a pound of ground coffee"], BANANA: ["bananas", "Banana", "a pound of bananas"],
  BACON: ["bacon", "Bacon", "a pound of sliced bacon"], CHKN: ["chicken-breast", "Chicken Breast", "a pound of boneless chicken breast"],
  BUTTER: ["butter", "Butter", "a pound of stick butter"], SUGAR: ["sugar", "Sugar", "a pound of white sugar"],
  ICECRM: ["ice-cream", "Ice Cream", "a half gallon of ice cream"], FLOUR: ["flour", "Flour", "a pound of white flour"],
  RICE: ["rice", "Rice", "a pound of long grain white rice"], COOKIE: ["cookies", "Cookie", "a pound of chocolate chip cookies"],
  STEAK: ["sirloin-steak", "Sirloin Steak", "a pound of boneless sirloin steak"], WCHKN: ["whole-chicken", "Whole Chicken", "a pound of whole chicken"],
  CHEDR: ["cheddar-cheese", "Cheddar Cheese", "a pound of cheddar cheese"], ORANGE: ["oranges", "Orange", "a pound of navel oranges"],
  POTATO: ["potatoes", "Potato", "a pound of white potatoes"], LETTUCE: ["lettuce", "Lettuce", "a pound of iceberg lettuce"],
  TOMATO: ["tomatoes", "Tomato", "a pound of tomatoes"], OJ: ["orange-juice", "Orange Juice", "16 oz of frozen orange juice concentrate"],
  BEER: ["beer", "Beer", "16 oz of beer"], WINE: ["wine", "Wine", "a liter of table wine"],
  CHIPS: ["potato-chips", "Potato Chip", "16 oz of potato chips"], LEMON: ["lemons", "Lemon", "a pound of lemons"],
  WHEAT: ["wheat-bread", "Wheat Bread", "a pound of whole wheat bread"],
  APPLE: ["apples", "Apple", "a pound of Red Delicious apples"], PBUTR: ["peanut-butter", "Peanut Butter", "a pound of creamy peanut butter"],
  TURKEY: ["turkey", "Turkey", "a pound of frozen whole turkey"], BOLOGNA: ["bologna", "Bologna", "a pound of bologna"],
  PEPPER: ["sweet-peppers", "Sweet Pepper", "a pound of sweet peppers"], BCHKN: ["bone-in-chicken-breast", "Bone-In Chicken Breast", "a pound of bone-in chicken breast"],
  RIBRST: ["rib-roast", "Rib Roast", "a pound of bone-in rib roast"], HOUSE: ["new-house", "New House", "a new house (median sale price)"],
  STAMP: ["postage-stamp", "Postage Stamp", "a first-class stamp"], SUBWAY: ["nyc-subway-fare", "NYC Subway Fare", "a New York City subway ride"],
  PORK: ["pork-chops", "Pork Chop", "a pound of bone-in pork chops"], PASTA: ["pasta", "Pasta", "a pound of spaghetti or macaroni"],
  AMCHS: ["american-cheese", "American Cheese", "a pound of American cheese"], HAM: ["ham", "Ham", "a pound of boneless ham"],
  ROAST: ["chuck-roast", "Chuck Roast", "a pound of boneless chuck roast"], STRAW: ["strawberries", "Strawberry", "a 12 oz pint of strawberries"],
  GAS: ["gas", "Gas", "a gallon of regular gas"], POWER: ["electricity", "Electricity", "a kilowatt-hour of electricity"],
  SONY: ["playstation", "PlayStation"], NTDOY: ["nintendo-consoles", "Nintendo Console"], MSFT: ["xbox", "Xbox"],
  "NTDOY.GB": ["nintendo-handhelds", "Nintendo Handheld"], SEGA: ["sega-consoles", "Sega Console"],
  AAPL: ["iphone", "iPhone"], IPAD: ["ipad", "iPad"], IPOD: ["ipod", "iPod"], MBAIR: ["macbook-air", "MacBook Air"],
  AWATCH: ["apple-watch", "Apple Watch"], AIRPOD: ["airpods", "AirPods"], KINDLE: ["kindle", "Kindle"], GOPRO: ["gopro", "GoPro"],
  NFLX: ["netflix", "Netflix"], SPOT: ["spotify", "Spotify"], AMZN: ["amazon-prime", "Amazon Prime"], DIS: ["disney-plus", "Disney+"],
  CIVIC: ["honda-civic", "Honda Civic"], CAMRY: ["toyota-camry", "Toyota Camry"], CRLA: ["toyota-corolla", "Toyota Corolla"],
  ACCORD: ["honda-accord", "Honda Accord"], CRV: ["honda-cr-v", "Honda CR-V"], RAV4: ["toyota-rav4", "Toyota RAV4"],
  F150: ["ford-f-150", "Ford F-150"], TSLA3: ["tesla-model-3", "Tesla Model 3"],
  MCD: ["big-mac", "Big Mac"], GOLD: ["gold", "Gold"], SILVER: ["silver", "Silver"],
};
const REGIONS = { NE: "Northeast", MW: "Midwest", S: "South", W: "West" };

const ALL = DATA.series.filter(s => !s.practice);
const bySym = Object.fromEntries(ALL.map(s => [s.sym, s]));
// Rows: [x (year), price, product, date label, source]. BLS series are January prices.
const rows = s => s.pts ? s.pts : s.v.map((p, i) => [s.start + i, p]).filter(r => r[1] != null);
// The newest row of a launch-price, subscription, Big Mac or metals series is "now" and is never a round.
// BLS series have a separate newest month.
const nowOf = s => {
  if (s.latest) { const [y, m] = s.latest.period.split("-").map(Number); return { p: s.latest.value, label: MON[m - 1] + " " + y, y, m } }
  const r = rows(s).at(-1); const m = monthOf(r); return { p: r[1], label: r[3] ? r[3].replace(/^(\w{3})\w*/, "$1") : String(r[0]), y: r[0], m };
};
function monthOf(r) { const i = r[3] ? MONTHS.findIndex(n => r[3].startsWith(n)) : -1; return i >= 0 ? i + 1 : 1 }
const adjFactor = (y, m) => { const c = cpiAt(y, m); return c ? CPI_NOW / c : null };
const city = loc => loc.replace(/ area$/, "").replace(/^Urban /, "");
const citySlug = loc => city(loc).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Every page, with its URL, so pages can link each other.
const list = [];
for (const s of ALL) {
  if (s.id && s.sym.includes(".")) continue; // BLS regions and cities are shown on their item's page
  const [slug, name, noun] = PAGES[s.sym] || [];
  if (!slug) throw new Error(`price-pages: no page name for ${s.sym}; add it to PAGES`);
  list.push({ s, slug, name, noun, kids: ALL.filter(k => k.id && k.sym.startsWith(s.sym + ".")) });
}
const cityPages = [];
for (const p of list) for (const k of p.kids) if (!/\(urban\)$/.test(k.loc))
  cityPages.push({ s: k, parent: p, slug: `${p.slug}-${citySlug(k.loc)}`, name: `${p.name} Prices in ${city(k.loc)}` });

// ---- HTML pieces ---------------------------------------------------------------------------------------------
function priceCell(s, r, adj) {
  const m = adj ? adjFactor(r[0], monthOf(r)) : null;
  if (adj && !m) return "<td>–</td>";
  return `<td>${adj ? cents(r[1] * m) : fmt(r[1])}</td>`;
}

function chart(series) {
  // series: [{s, color}] drawn on one axis.
  const W = 480, H = 220, L = 50, R = 8, T = 10, B = 24;
  const pts = series.map(({ s }) => {
    const n = nowOf(s), rs = rows(s).map(r => ({ x: r[0] + (monthOf(r) - 1) / 12, p: r[1] }));
    if (s.latest || !s.pts) rs.push({ x: n.y + (n.m - 1) / 12, p: n.p });
    return rs;
  });
  if (pts.every(rs => rs.length < 2)) return "";
  const xs = pts.flat().map(r => r.x), ys = pts.flat().map(r => r.p);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), top = niceMax(Math.max(...ys));
  const X = x => L + (x - x0) / Math.max(1, x1 - x0) * (W - L - R), Y = p => T + (1 - p / top) * (H - T - B);
  let out = "";
  for (let i = 0; i <= 4; i++) {
    const v = top * i / 4;
    out += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="g"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${tick(v, top)}</text>`;
  }
  const step = x1 - x0 > 30 ? 10 : x1 - x0 > 12 ? 5 : x1 - x0 > 5 ? 2 : 1;
  for (let y = Math.ceil(x0 / step) * step; y <= x1; y += step) out += `<text x="${X(y).toFixed(1)}" y="${H - 6}" text-anchor="middle">${y}</text>`;
  pts.forEach((rs, i) => {
    const color = series[i].color;
    const d = rs.length > 1 ? "M" + rs.map(r => X(r.x).toFixed(1) + " " + Y(r.p).toFixed(1)).join("L") : "";
    out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (rs.length < 20) out += rs.map(r => `<circle cx="${X(r.x).toFixed(1)}" cy="${Y(r.p).toFixed(1)}" r="3.5" fill="${color}"/>`).join("");
  });
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart of the prices in the table below">${out}</svg>`;
}
function niceMax(v) { const e = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * e >= v) return k * e; return 10 * e }
function tick(v, top) { return v === 0 ? "$0" : top >= 10000 ? "$" + (v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "k" : top >= 20 ? "$" + Math.round(v).toLocaleString("en-US") : "$" + v.toFixed(2) }

// First price vs now, and the same stretch for all prices (CPI). The newest row of a pts series is "now",
// so it doesn't count as a first price.
function summary(s, noun) {
  const n = nowOf(s), past = s.pts ? rows(s).slice(0, -1) : rows(s), first = past[0];
  const per = s.cat === "Metals" ? " an ounce" : "";
  if (!first) return `Latest price: <b>${fmt(n.p)}</b>${per} (${n.label}).`;
  const fm = monthOf(first), when = s.pts && first[3] ? first[3] : (s.pts && s.cat !== "Metals" ? "" : "January ") + first[0];
  const what = noun || (s.sym === "MCD" ? "a Big Mac" : s.pts && first[2] ? "the " + esc(first[2]) : esc(s.line || s.name));
  const nowWhat = s.pts && rows(s).at(-1)[2] && rows(s).at(-1)[2] !== first[2] ? ` The newest, the ${esc(rows(s).at(-1)[2])}, is` : "";
  const c0 = cpiAt(first[0], fm), up = pct(first[1], n.p), cpiUp = c0 ? pct(c0, CPI_NOW) : null;
  let t = nowWhat
    ? `${cap(what)} cost <b>${fmt(first[1])}</b> in ${when}.${nowWhat} <b>${fmt(n.p)}</b> (${n.label}), ${up >= 0 ? "up" : "down"} ${Math.abs(up)}%.`
    : `${cap(what)} cost <b>${fmt(first[1])}</b>${per} in ${when} and <b>${fmt(n.p)}</b> in ${n.label}, ${up >= 0 ? "up" : "down"} ${Math.abs(up)}%.`;
  if (cpiUp != null) { const real = Math.round((n.p / first[1]) / (CPI_NOW / c0) * 100 - 100); t += ` Overall U.S. prices rose ${cpiUp}% in that time, so adjusted for inflation it's ${real === 0 ? "about the same" : Math.abs(real) + "% " + (real > 0 ? "more expensive" : "cheaper")}.`; }
  return t;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// An item's rounds can use its regions and cities ("GAS.CHI:1995"); all of them hide the item's pages.
const base = sym => sym.split(".")[0];

function srcLine(s) {
  if (s.id) return `U.S. Bureau of Labor Statistics, Average Price Data, series <a href="https://fred.stlouisfed.org/series/${esc(s.id)}" rel="noopener">${esc(s.id)}</a> (via FRED). Prices are January averages for urban areas; the newest row is the latest month published.`;
  return `${esc(s.src || "Each product's Wikipedia article")}. Prices are ${esc(s.unit)}.`;
}

function page({ title, desc, path, crumbs, body, ld, noindex }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${path}">${noindex ? '\n<meta name="robots" content="noindex">' : ""}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#0a0e13">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600;800&display=swap">
<link rel="stylesheet" href="/src/styles.css">
<link rel="stylesheet" href="/src/prices.css">
<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: crumbs.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: SITE + u })) },
    ...(ld ? [ld] : [])] })}
</script>
</head>
<body>
<main class="wrap ph">
  <header class="top"><div class="brand"><h1 class="logo"><a href="/">Inflation<em>dle</em></a></h1></div><a class="chip play" href="/">Play today's round</a></header>
  <nav class="crumbs">${crumbs.map(([n, u], i) => i === crumbs.length - 1 ? `<span>${esc(n)}</span>` : `<a href="${u}">${esc(n)}</a>`).join(" › ")}</nav>
${body}
  <p class="foot"><a href="/">Inflationdle</a> · <a href="/prices/">All price histories</a> · <a href="/privacy">Privacy</a></p>
</main>
</body>
</html>
`;
}

const cta = `<p class="cta"><a href="/">Play today's Inflationdle</a>. Each day is one real price from the past, and you get six guesses.</p>`;
const dataset = (name, desc, path, s, x0, x1) => ({
  "@type": "Dataset", name, description: desc, url: SITE + path, temporalCoverage: `${x0}/${x1}`,
  spatialCoverage: s.loc, creator: { "@type": "Organization", name: "Inflationdle", url: SITE + "/" },
  isBasedOn: s.id ? `https://fred.stlouisfed.org/series/${s.id}` : undefined,
  variableMeasured: `Price in U.S. dollars, ${s.unit}`,
});

function related(p) {
  const same = list.filter(o => o.s.cat === p.s.cat && o !== p).slice(0, 12);
  return same.length ? `<h2>More ${esc(p.s.cat.toLowerCase())} prices</h2><p class="rel">${same.map(o => `<a href="/prices/${o.slug}">${esc(o.name)}</a>`).join(" · ")}</p>` : "";
}

// ---- item page -----------------------------------------------------------------------------------------------
function itemPage(p) {
  const { s, name, noun, kids } = p;
  const rs = rows(s), n = nowOf(s), x0 = rs[0][0], x1 = n.y;
  const title = `${name} Prices by Year (${x0}–${x1}) · Inflationdle`;
  const path = `/prices/${p.slug}`;
  const regions = kids.filter(k => /\(urban\)$/.test(k.loc));
  const cities = kids.filter(k => !/\(urban\)$/.test(k.loc));
  const cell = priceCell;
  let table;
  if (s.pts) {
    const showProduct = rs.some(r => r[2]);
    table = `<table><thead><tr><th>Date</th>${showProduct ? '<th class="p">Product</th>' : ""}<th>Price</th><th>In today's dollars</th></tr></thead><tbody>` +
      rs.slice().reverse().map((r, i) => {
        const isNow = i === 0, lbl = r[3] ? esc(r[3].replace(/^(\w{3})\w*/, "$1")) : (s.cat === "Metals" ? "January " : "") + r[0];
        const date = /^https:\/\//.test(r[4] || "") ? `<a class="s" href="${esc(r[4])}" rel="noopener nofollow" title="Source for this price">${lbl}</a>` : lbl;
        const pc = isNow ? `<td>${fmt(r[1])}</td>` : cell(s, r, false);
        const ac = isNow ? (adjFactor(r[0], monthOf(r)) ? `<td>${cents(r[1] * adjFactor(r[0], monthOf(r)))}</td>` : "<td>–</td>") : cell(s, r, true);
        return `<tr><td>${date}</td>${showProduct ? `<td class="p">${esc(r[2] || "")}</td>` : ""}${pc}${ac}</tr>`;
      }).join("") + "</tbody></table>";
  } else {
    const cols = [s, ...regions];
    const head = `<tr><th>Year</th><th>U.S. average</th><th>In today's dollars</th>${regions.map(k => `<th>${REGIONS[k.sym.split(".")[1]]}</th>`).join("")}</tr>`;
    const years = [...new Set(cols.flatMap(k => rows(k).map(r => r[0])))].sort((a, b) => b - a);
    const nowRow = `<tr class="now"><td>${n.label}</td><td>${fmt(n.p)}</td><td>${cents(n.p)}</td>${regions.map(k => `<td>${k.latest ? fmt(k.latest.value) + `<small> ${nowOf(k).label}</small>` : "–"}</td>`).join("")}</tr>`;
    table = `<table><thead>${head}</thead><tbody>${nowRow}` + years.map(y => {
      const at = k => rows(k).find(r => r[0] === y);
      const main = at(s);
      return `<tr><td>Jan ${y}</td>${main ? cell(s, main, false) + cell(s, main, true) : "<td>–</td><td>–</td>"}${regions.map(k => at(k) ? cell(k, at(k), false) : "<td>–</td>").join("")}</tr>`;
    }).join("") + "</tbody></table>";
  }
  const lead = summary(s, noun);
  const desc = `${name} prices by year from ${x0} to ${x1}: ${stripTags(lead)}`.slice(0, 300);
  const cityList = cities.length ? `<h2>${esc(name)} prices by city</h2><table class="narrow"><thead><tr><th>City</th><th>Latest</th></tr></thead><tbody>${cities.map(k => {
    const cp = cityPages.find(c => c.s === k), ln = nowOf(k);
    return `<tr><td><a href="/prices/${cp.slug}">${esc(city(k.loc))}</a></td><td>${fmt(ln.p)} <small>${ln.label}</small></td></tr>`;
  }).join("")}</tbody></table>` : "";
  const body = `  <article>
  <h1>${esc(name)} Prices by Year, ${x0}–${x1}</h1>
  <p class="lead">${lead}</p>
  ${cta}
  ${chart([{ s, color: "var(--up)" }])}
  <h2>${esc(name)} price history</h2>
  <p class="sub">${esc(s.pts ? cap(s.unit) : `U.S. city average, ${s.unit}`)}. "In today's dollars" adjusts each price for inflation with the CPI, up to ${cpiNowLabel}.</p>
  ${regions.length ? `<p class="scrollhint">Swipe the table sideways to see the four regions.</p>` : ""}
  <div class="tbl">${table}</div>
  ${cityList}
  <h2>Source</h2>
  <p class="sub">${srcLine(s)} Inflation adjustment: BLS CPI-U, all items (FRED CPIAUCNS).</p>
  ${related(p)}
  </article>`;
  const crumbs = [["Inflationdle", "/"], ["Price history", "/prices/"], [name + " prices", path]];
  return { path, sym: base(s.sym), html: page({ title, desc, path, crumbs, body, ld: dataset(`${name} prices by year`, desc, path, s, x0, x1) }) };
}
const stripTags = h => h.replace(/<[^>]+>/g, "");

// ---- city page (gas and electricity) --------------------------------------------------------------------------
function cityPage(c) {
  const { s, parent } = c;
  const rs = rows(s), n = nowOf(s), x0 = rs[0][0], x1 = n.y, where = city(s.loc);
  const path = `/prices/${c.slug}`;
  const title = `${c.name} by Year (${x0}–${x1}) · Inflationdle`;
  const cell = (r, adj) => priceCell(s, r, adj);
  const nat = bySym[parent.s.sym];
  const natAt = y => rows(nat).find(r => r[0] === y);
  const table = `<table><thead><tr><th>Year</th><th>${esc(where)}</th><th>In today's dollars</th><th>U.S. average</th></tr></thead><tbody>` +
    `<tr class="now"><td>${n.label}</td><td>${fmt(n.p)}</td><td>${cents(n.p)}</td><td>${fmt(nowOf(nat).p)} <small>${nowOf(nat).label}</small></td></tr>` +
    rs.slice().reverse().map(r => `<tr><td>Jan ${r[0]}</td>${cell(r, false)}${cell(r, true)}${natAt(r[0]) ? priceCell(nat, natAt(r[0]), false) : "<td>–</td>"}</tr>`).join("") + "</tbody></table>";
  const lead = summary(s, parent.noun.replace(/^a /, "a ") + ` in the ${where} area`);
  const desc = `${c.name} by year from ${x0} to ${x1}: ${stripTags(lead)}`.slice(0, 300);
  const others = cityPages.filter(o => o.parent === parent && o !== c).map(o => `<a href="/prices/${o.slug}">${esc(city(o.s.loc))}</a>`).join(" · ");
  const body = `  <article>
  <h1>${esc(c.name)} by Year, ${x0}–${x1}</h1>
  <p class="lead">${lead}</p>
  ${cta}
  ${chart([{ s: nat, color: "var(--muted)" }, { s, color: "var(--up)" }])}
  <p class="sub legend"><span class="k1"></span>${esc(where)} <span class="k2"></span>U.S. average</p>
  <h2>${esc(parent.name)} price history in ${esc(where)}</h2>
  <p class="sub">${esc(s.loc)}, ${esc(s.unit)}. "In today's dollars" adjusts each price for inflation with the national CPI, up to ${cpiNowLabel}.</p>
  <div class="tbl">${table}</div>
  <h2>Source</h2>
  <p class="sub">${srcLine(s)} Inflation adjustment: BLS CPI-U, all items (FRED CPIAUCNS).</p>
  <h2>Other cities</h2>
  <p class="rel"><a href="/prices/${parent.slug}">U.S. average</a> · ${others}</p>
  </article>`;
  const crumbs = [["Inflationdle", "/"], ["Price history", "/prices/"], [parent.name + " prices", `/prices/${parent.slug}`], [where, path]];
  return { path, sym: base(parent.s.sym), html: page({ title, desc, path, crumbs, body, ld: dataset(`${c.name} by year`, desc, path, s, x0, x1) }) };
}

// ---- index ---------------------------------------------------------------------------------------------------
function indexPage() {
  const cats = [...new Set(list.map(p => p.s.cat))];
  const body = `  <article>
  <h1>Price History: What Things Cost, Year by Year</h1>
  <p class="lead">Real U.S. prices for groceries, gas, electricity, gadgets, cars, subscriptions and more, from official data and launch announcements, with every price also shown in today's dollars. These are the prices behind Inflationdle's daily rounds.</p>
  ${cta}
  ${cats.map(c => `<h2>${esc(c)}</h2><table class="narrow"><thead><tr><th>Item</th><th>Latest</th></tr></thead><tbody>${list.filter(p => p.s.cat === c).map(p => {
    const n = nowOf(p.s); return `<tr data-sym="${base(p.s.sym)}"><td><a href="/prices/${p.slug}">${esc(p.name)}</a></td><td>${fmt(n.p)} <small>${n.label}</small></td></tr>`;
  }).join("")}</tbody></table>`).join("\n  ")}
  <h2>Gas and electricity by city</h2>
  ${list.filter(p => cityPages.some(c => c.parent === p)).map(p => `<h3>${esc(p.name)}</h3><p class="rel">${cityPages.filter(c => c.parent === p).map(c => `<a href="/prices/${c.slug}">${esc(city(c.s.loc))}</a>`).join(" · ")}</p>`).join("\n  ")}
  </article>`;
  const path = "/prices/";
  return { path, html: page({ title: "Price History by Year: Groceries, Gas, Gadgets and More · Inflationdle", desc: "What things cost year by year in the U.S.: eggs, milk, gas, electricity, iPhones, consoles, cars, Netflix, Big Macs and gold, with each price adjusted for inflation.", path, crumbs: [["Inflationdle", "/"], ["Price history", "/prices/"]], body }) };
}

// ---- hidden page ---------------------------------------------------------------------------------------------
// What worker/index.js serves in place of an item's page while the item's round is live. It names no item and no
// price; the Worker fills in {{ENDS}} (when the round ends everywhere).
function hiddenPage() {
  const body = `  <article>
  <h1>Hidden during today's round</h1>
  <p class="lead">This item is in today's Inflationdle round, so its prices are hidden until the round ends everywhere, {{ENDS}}. If you've already played that round on this browser, reload this page to see it.</p>
  ${cta}
  </article>`;
  const path = "/prices/hidden";
  return { path, html: page({ title: "Hidden during today's round · Inflationdle", desc: "This price history comes back when today's Inflationdle round ends.", path, crumbs: [["Inflationdle", "/"], ["Price history", "/prices/"]], body, noindex: true }) };
}

// ---- write ---------------------------------------------------------------------------------------------------
rmSync("prices", { recursive: true, force: true });
mkdirSync("prices");
const out = [indexPage(), ...list.map(itemPage), ...cityPages.map(cityPage)];
for (const o of [...out, hiddenPage()]) writeFileSync(o.path === "/prices/" ? "prices/index.html" : `prices${o.path.slice(7)}.html`, o.html);
// Which item each page shows, for worker/index.js.
writeFileSync("prices/pages.json", JSON.stringify(Object.fromEntries(out.filter(o => o.sym).map(o => [o.path, o.sym]))) + "\n");

const keep = readFileSync("sitemap.xml", "utf8").split("\n").filter(l => l.includes("<url>") && !l.includes("/prices/"));
writeFileSync("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${keep.join("\n")}
${out.map(o => `  <url><loc>${SITE}${o.path}</loc><changefreq>weekly</changefreq></url>`).join("\n")}
</urlset>
`);
console.log(`wrote ${out.length} pages to prices/ and updated sitemap.xml`);
