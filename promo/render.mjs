// Renders promo/<name>.html frame by frame to PNGs:
//   node render.mjs <name> <seconds> <fps> <width> <height> [query] [outDir] [everyNth]
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import { mkdirSync, rmSync } from 'node:fs';
const [name, dur, fps, w, h, query = '', out = 'frames', every = '1'] = process.argv.slice(2);
const b = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});
const p = await b.newPage({viewport: {width: +w, height: +h}});
await p.goto(`http://localhost:${process.env.PORT || 8124}/${name}.html${query ? '?' + query : ''}`);
await p.evaluate(() => document.fonts.ready);
rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const N = Math.round(dur * fps);
// Tall phones fill the screen by cropping the sides of a 9:16 video (about 100 px each side at 1080 wide),
// so once a second this flags visible text that reaches into those edges.
const SAFE = Math.round(+w * 0.09), clipped = new Map();
const edgeText = ([safe, W]) => {
  const seen = [], walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);  // the ticker scrolls on purpose
  for (let n; (n = walk.nextNode());) {
    if (!n.textContent.trim() || n.parentElement.closest('.tick')) continue;
    let op = 1; for (let e = n.parentElement; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    if (op < 0.5) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const b of r.getClientRects()) if (b.width && (b.left < safe || b.right > W - safe))
      seen.push(`"${n.textContent.trim().slice(0, 40)}" spans ${Math.round(b.left)}-${Math.round(b.right)} px`);
  }
  return seen;
};
for (let i = 0; i < N; i++) { if (i % +every) continue;
  await p.evaluate(t => render(t), i / fps);
  if (i % +fps === 0) for (const m of await p.evaluate(edgeText, [SAFE, +w])) if (!clipped.has(m)) clipped.set(m, i / fps);
  await p.screenshot({path: `${out}/f${String(i).padStart(4, '0')}.png`}); }
for (const [m, t] of clipped) console.log(`::warning::${name} at ${t}s: ${m}, outside the ${SAFE} px phone-safe margin`);
await b.close();
