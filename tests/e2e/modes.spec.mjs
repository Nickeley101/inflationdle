// Practice mode, the country dailies and keyboard play.
import {test, expect, openGame, bid, stats} from "./fixtures.mjs";
import {winningBid, losingBids, countries, roundFor} from "../lib/game-data.mjs";

test.describe("practice", () => {
  test("deals rounds without touching the daily or its stats", async ({page}) => {
    const r = await openGame(page);
    await bid(page, losingBids(r)[0]);
    await page.locator("#mPractice").click();
    await expect(page.locator("#mPractice")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#no")).toBeEmpty();
    await expect(page.locator("#catSel")).toBeVisible();
    await expect(page.locator("#skip")).toBeVisible();
    await expect(page.locator("#lcount")).toHaveText("0 of 6");
    // Play a practice round to the end.
    await bid(page, "99999");
    for (let i = 0; i < 5 && await page.locator("#form").isVisible(); i++) {
      const hi = await page.locator("#log li").evaluateAll(li => li.length);
      await bid(page, (99990 - hi * 10).toFixed(2));
    }
    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#again")).toBeVisible();
    await expect(page.locator("#next")).toBeHidden();
    expect((await page.locator("#shareText").textContent()).split("\n")[0]).toContain("(practice)");
    expect(await stats(page)).toBeNull();
    await page.locator("#again").click();
    await expect(page.locator("#result")).not.toBeVisible();
    await expect(page.locator("#lcount")).toHaveText("0 of 6");
    // Back to the daily: the earlier bid is still there.
    await page.locator("#mDaily").click();
    await expect(page.locator("#no")).toHaveText("#" + r.day);
    await expect(page.locator("#lcount")).toHaveText("1 of 6");
  });

  test("the category picker only deals that category", async ({page}) => {
    await openGame(page);
    await page.locator("#mPractice").click();
    for (const cat of ["Energy", "Electronics", "Groceries"]) {
      await page.locator("#catSel").selectOption(cat);
      for (let i = 0; i < 4; i++) {
        await expect(page.locator("#unit")).toContainText(cat);
        await page.locator("#skip").click();
      }
    }
  });

  test("the unit line names the unit in bold and the bid box ends in its short form", async ({page}) => {
    await openGame(page);
    await page.locator("#mPractice").click();
    await page.locator("#catSel").selectOption("Energy");
    for (let i = 0; i < 4; i++) {
      const unit = await page.locator("#unit b").textContent();
      expect(unit).toMatch(/^per (kilowatt-hour|gallon)$/);
      await expect(page.locator("#per")).toHaveText(unit.includes("kilowatt") ? "/ kWh" : "/ gal");
      await expect(page.locator("#guess")).toHaveAttribute("aria-label", /per (kilowatt-hour|gallon)$/);
      await page.locator("#skip").click();
    }
  });

  test("skip and the N key deal a new item", async ({page}, info) => {
    test.skip(info.project.name.startsWith("phone"), "keyboard shortcut");
    await openGame(page);
    await page.locator("#mPractice").click();
    const seen = new Set([await page.locator("#item").textContent()]);
    for (let i = 0; i < 4; i++) {
      await page.locator("body").press("n");
      seen.add(await page.locator("#item").textContent());
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

test.describe("countries", () => {
  for (const c of countries()) {
    test(`${c.name}: ?c=${c.code} plays its own daily in its currency`, async ({page}) => {
      const r = await openGame(page, {country: c.code});
      expect(r, `${c.code} schedule covers today`).toBeTruthy();
      await expect(page.locator("#ctySel")).toHaveValue(c.code);
      await expect(page.locator("#no")).toHaveText("#" + r.day);
      await expect(page.locator("#curLbl")).not.toHaveText("US$");
      await bid(page, winningBid(r, c.code));
      await expect(page.locator("#verdict")).toHaveText("Order filled in 1/6");
      const share = await page.locator("#shareText").textContent();
      expect(share.split("\n")[0]).toBe(`Inflationdle ${c.flag} #${r.day} 1/6`);
      expect(share.trim().split("\n").at(-1)).toBe(`https://inflationdle.com/?c=${c.code}`);
      // Stats are kept per country; the U.S. ones stay untouched.
      expect(await stats(page)).toBeNull();
      expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), "ic-stats-" + c.code)).toMatchObject({played: 1, wins: 1});
    });
  }

  test("the picker switches country and remembers it", async ({page}) => {
    await openGame(page);
    const [first] = countries();
    await Promise.all([page.waitForURL(`**/?c=${first.code}`), page.locator("#ctySel").selectOption(first.code)]);
    await expect(page.locator("#ctySel")).toHaveValue(first.code);
    await page.goto("/");
    await expect(page.locator("#ctySel")).toHaveValue(first.code);
    await Promise.all([page.waitForURL(u => !u.search), page.locator("#ctySel").selectOption("us")]);
    await expect(page.locator("#curLbl")).toHaveText("US$");
  });

  test("an unknown or malformed country code falls back to the U.S. game", async ({page, issues}) => {
    issues.allow(/404 \(Not Found\)/); // the game asks for data/countries/zz.json first
    for (const bad of ["zz", "../../etc", "<script>", "US%00"]) {
      await openGame(page, {query: "c=" + encodeURIComponent(bad)});
      await expect(page.locator("#curLbl")).toHaveText("US$");
      await expect(page.locator("#no")).toHaveText("#" + roundFor(new Date().toLocaleDateString("en-CA", {timeZone: "America/New_York"})).day);
    }
  });
});

test.describe("auto-pick by browser language", () => {
  test.use({locale: "ja-JP"});
  test("a Japanese browser gets the Japan daily", async ({page}) => {
    await openGame(page);
    await expect(page.locator("#ctySel")).toHaveValue("jp");
  });
});

test.describe("keyboard", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name.startsWith("phone"), "keyboard play is for desktop"));

  test("a whole round plays from the keyboard", async ({page}) => {
    const r = await openGame(page);
    await page.locator("#guess").focus();
    await page.keyboard.type(losingBids(r)[0]);
    await page.keyboard.press("Enter");
    await expect(page.locator("#lcount")).toHaveText("1 of 6");
    await expect(page.locator("#guess")).toBeFocused();
    await page.keyboard.type(winningBid(r));
    await page.keyboard.press("Enter");
    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#copy")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#result")).not.toBeVisible();
    await page.locator("body").press("r");
    await expect(page.locator("#result")).toBeVisible();
  });

  test("Tab reaches the mode buttons, the bid box and the bid button in order", async ({page}) => {
    await openGame(page);
    const order = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
    }
    const i = id => order.indexOf(id);
    for (const id of ["mDaily", "mPractice", "guess", "buy"]) expect(order, id).toContain(id);
    expect(i("mDaily")).toBeLessThan(i("guess"));
    expect(i("guess")).toBeLessThan(i("buy"));
  });

  test("the chart reads out prices with the arrow keys", async ({page}) => {
    const r = await openGame(page);
    await bid(page, winningBid(r));
    await page.locator("#chart").focus();
    await page.keyboard.press("Home");
    await expect(page.locator("#chartSr")).not.toBeEmpty();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#cx")).toHaveAttribute("visibility", "visible");
  });
});

test.describe("how to play", () => {
  test("the footer link opens the rules in a pop-up that closes again", async ({page}) => {
    await openGame(page);
    await expect(page.locator("#howPlay")).toBeHidden();
    await page.locator("#howLink").click();
    await expect(page.locator("#help")).toBeVisible();
    await expect(page.locator("#howPlay")).toContainText("six bids");
    await expect(page).not.toHaveURL(/#/);
    await page.locator("#gotIt").click();
    await expect(page.locator("#help")).not.toBeVisible();
    await page.locator("#howLink").click();
    await page.locator("#closeHelp").click();
    await expect(page.locator("#help")).not.toBeVisible();
  });
});

test.describe("questions", () => {
  test("start folded and open in place", async ({page}) => {
    await openGame(page);
    await expect(page.locator(".faq h3").first()).toBeHidden();
    await page.locator(".faq summary").click();
    await expect(page.locator(".faq h3").first()).toBeVisible();
    await expect(page.locator(".faq")).toContainText("Where do the prices come from?");
  });
});
