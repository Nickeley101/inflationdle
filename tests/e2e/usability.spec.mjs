// Accessibility and usability: axe-core scans (WCAG 2.2 A/AA) of every kind of page and game state, plus checks
// axe can't do: tap target sizes, fitting on a small phone, reduced motion and screen-reader announcements.
import {test, expect, openGame, bid} from "./fixtures.mjs";
import {winningBid, losingBids, liveHiddenPath, shownPricePage} from "../lib/game-data.mjs";

let AxeBuilder = null;
try { ({default: AxeBuilder} = await import("@axe-core/playwright")); } catch {}

// Rules axe flags today that are known and accepted, each with the reason. Anything else fails the test.
// Remove an entry once it's fixed, so it can't come back.
const KNOWN = {
  "scrollable-region-focusable": "found 2026-09-27: the price table (.tbl) on /prices/ item pages scrolls sideways on phones but can't be reached by keyboard; give it tabindex=\"0\" and an aria-label",
};
// Tap targets known to be a little small, by element id, with the size found. Same rule: remove once fixed.
const KNOWN_SMALL = {closeRes: "the results pop-up's close button is 43x43 on phones, 1px under 44"};

async function scan(page, what, include) {
  test.skip(!AxeBuilder, "@axe-core/playwright is not installed (npm install in tests/)");
  let b = new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]);
  if (include) b = b.include(include);
  const {violations} = await b.analyze();
  const found = violations.filter(v => !(KNOWN[v.id])).map(v =>
    `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map(n => n.target.join(" ")).join("\n    ")}`);
  expect(found, `axe violations on ${what}`).toEqual([]);
}

test.describe("axe scans", () => {
  // axe re-reads stylesheets with fetch(), which the site's CSP (rightly) blocks for Google Fonts. The CSP itself is
  // covered by every other browser test, so these scans run with it off.
  test.use({bypassCSP: true});
  test("game, fresh", async ({page}) => { await openGame(page); await scan(page, "the fresh game"); });

  test("game, mid-round with an error showing", async ({page}) => {
    const r = await openGame(page);
    await bid(page, losingBids(r)[0]);
    await bid(page, losingBids(r)[0]);
    await expect(page.locator("#err")).toBeVisible();
    await scan(page, "a round in progress");
  });

  test("results pop-up, won and lost", async ({page}) => {
    const r = await openGame(page);
    await bid(page, winningBid(r));
    await expect(page.locator("#result")).toBeVisible();
    await page.waitForTimeout(1300); // let the closing-bell count-up finish
    await scan(page, "the win results", "#result");
    await page.locator("#closeRes").click();
    await page.locator("#mPractice").click();
    for (let i = 0; i < 6 && await page.locator("#form").isVisible(); i++) await bid(page, (99990 - i * 10).toFixed(2));
    await expect(page.locator("#result")).toBeVisible();
    await page.waitForTimeout(1300);
    await scan(page, "the practice loss results", "#result");
  });

  test("practice mode", async ({page}) => { await openGame(page); await page.locator("#mPractice").click(); await scan(page, "practice"); });
  test("a country daily", async ({page}) => { await openGame(page, {country: "jp"}); await scan(page, "the Japan daily"); });

  // An item page and a city page that are showing today (a live item's pages are hidden), plus the page a live
  // item's price history shows instead while its round is on.
  const hiddenPath = liveHiddenPath();
  const shown = [shownPricePage(/^\/prices\/[a-z]+$/), shownPricePage(/^\/prices\/(gas|electricity)-/)];
  for (const path of ["/prices/", ...shown, hiddenPath, "/privacy.html"].filter(Boolean)) {
    test(`page ${path}`, async ({page, issues}) => {
      if (path === hiddenPath) issues.allow(/status of 503/); // hidden pages answer 503 on purpose
      const res = await page.goto(path);
      expect(res.status()).toBe(path === hiddenPath ? 503 : 200);
      await scan(page, path);
    });
  }
});

test.describe("usability", () => {
  test("buttons and fields are big enough to tap", async ({page}, info) => {
    const phone = info.project.name.startsWith("phone");
    const min = phone ? 44 : 24; // Apple/Google touch guidance on phones; WCAG 2.2 target size (2.5.8) elsewhere
    const r = await openGame(page);
    const check = async where => {
      const small = await page.locator(`${where} :is(button, input, select, [role=button]):visible`).evaluateAll((els, min) =>
        els.map(e => ({e, b: e.getBoundingClientRect()})).filter(({b}) => b.width && (b.height < min - .5 || b.width < min - .5))
          .map(({e, b}) => `${e.id || e.className || e.tagName} ${Math.round(b.width)}x${Math.round(b.height)}`), min)
        .then(list => list.filter(t => !(phone && KNOWN_SMALL[t.split(" ")[0]])));
      expect(small, `targets under ${min}px in ${where}`).toEqual([]);
    };
    await check("main");
    await bid(page, winningBid(r));
    await expect(page.locator("#result")).toBeVisible();
    await check("#result");
  });

  for (const width of [320, 375]) {
    test(`fits a ${width}px-wide phone without sideways scrolling`, async ({page}, info) => {
      test.skip(!info.project.name.startsWith("phone"));
      await page.setViewportSize({width, height: 700});
      const r = await openGame(page);
      // Names what sticks out past the right edge, so a failure says which element to fix (the ticker scrolls on purpose).
      const wide = () => page.evaluate(() => { const w = document.documentElement.clientWidth;
        return [...document.querySelectorAll("body *")].filter(e => !e.closest(".tape") && e.getBoundingClientRect().right > w + .5)
          .map(e => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${e.className} ${Math.round(e.getBoundingClientRect().right - w)}px`).slice(0, 8); });
      const fits = async () => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `page is ${over}px too wide: ${(await wide()).join(", ")}`).toBeLessThanOrEqual(0);
      };
      await fits();
      await bid(page, losingBids(r)[0]);
      await bid(page, winningBid(r));
      await expect(page.locator("#result")).toBeVisible();
      const d = await page.locator("#result").boundingBox();
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(width + .5);
      await page.locator("#closeRes").click();
      await fits();
    });
  }

  test("the bid box brings up a number keyboard on phones", async ({page}) => {
    await openGame(page);
    await expect(page.locator("#guess")).toHaveAttribute("inputmode", "decimal");
    await expect(page.locator("#guess")).toHaveAccessibleName(/price guess/i);
  });

  test("every bid is announced to screen readers", async ({page}) => {
    const r = await openGame(page);
    await expect(page.locator("#sr")).toHaveAttribute("role", "status");
    await bid(page, losingBids(r)[0]);
    await expect(page.locator("#sr")).toContainText("Bid 1:");
    await expect(page.locator("#sr")).toContainText("5 guesses left");
    await bid(page, "abc");
    await expect(page.locator("#err")).toHaveAttribute("role", "alert");
  });

  test.describe("reduced motion", () => {
    test("the ticker and the price count-up hold still", async ({page}) => {
      await page.emulateMedia({reducedMotion: "reduce"});
      const r = await openGame(page);
      expect(await page.locator("#tape").evaluate(e => getComputedStyle(e).animationName)).toBe("none");
      await bid(page, winningBid(r));
      // Without motion the price shows at once instead of counting up.
      await expect(page.locator("#rActual")).toHaveText(/\d/, {timeout: 200});
    });
  });

  test("the page has one h1, a language and a title", async ({page}) => {
    await openGame(page);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Inflationdle/);
  });
});
