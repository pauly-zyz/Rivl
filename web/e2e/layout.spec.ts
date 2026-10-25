import { expect, test } from "@playwright/test";

import { connect, deployment, pageErrors, playerPage, takeCreatedPages } from "./wallet";

/*
 * Tahap 4 poin 6: semua halaman rapi di 375px dan desktop, tanpa error di console.
 */

/** Setiap halaman yang dibuka test ini harus bebas error console; context ditutup supaya tidak jalan di latar. */
test.afterEach(async () => {
  const pages = takeCreatedPages();
  const errors = pages.flatMap((p) => pageErrors(p));
  await Promise.all(pages.map((p) => p.context().close()));
  expect(errors, "error console browser").toEqual([]);
});

const PAGES = ["/", "/me", "/spin", "/duel/1", "/fair", "/fair?id=1", "/rules", "/terms", "/responsible-gaming"];
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "desktop", width: 1280, height: 900 },
];

for (const vp of VIEWPORTS) {
  test(`semua halaman di ${vp.name} (${vp.width}px): tanpa scroll horizontal dan tanpa error console`, async ({ browser }) => {
    const page = await playerPage(browser, deployment().testAccounts[0]!, { width: vp.width, height: vp.height });
    await page.goto("/");
    await connect(page);

    for (const path of PAGES) {
      const before = pageErrors(page).length;
      await page.goto(path);
      await expect(page.getByTestId("footer")).toBeVisible();
      // Bukan "networkidle": halaman sengaja memperbarui data tiap ±1,5 detik (lib/live.ts), jadi jaringan jarang diam.
      await page.waitForLoadState("load");
      await page.waitForTimeout(2_000);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} melebar ${overflow}px`).toBeLessThanOrEqual(0);
      expect(pageErrors(page).slice(before), `error console di ${path}`).toEqual([]);

      const slug = path === "/" ? "lobby" : path.replace(/[/?=]+/g, "-").replace(/^-/, "");
      await page.screenshot({ path: `e2e-screens/layout-${vp.name}-${slug}.png`, fullPage: true, animations: "disabled" });
    }
  });
}
