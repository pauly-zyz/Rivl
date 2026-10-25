import { expect, test, type Page } from "@playwright/test";
import { parseEther, type Address } from "viem";

import { balanceOf, playSuit } from "./chain";
import { connect, deployment, pageErrors, playerPage, takeCreatedPages } from "./wallet";

/*
 * Daily Spin di chain lokal: akun #1–#3 memegang 3 jt RIVL (lolos syarat), #4 hanya 1 jt.
 * Hasil spin diatur lewat panel owner (peluang 100% satu hadiah) supaya test pasti.
 */

const d = deployment();
const [ALICE, BOB, CAROL, DAVE] = d.testAccounts as [Address, Address, Address, Address];
const RIVL = d.contracts.rivl as Address;
const SHOTS = "e2e-screens";

const DEFAULT_ODDS = { try_again: "40", fee_free_1: "18", fee_free_3: "4", xp_50: "20", xp_150: "7", cosmetic: "10", rivl_10k: "0.8", rivl_50k: "0.2" };

test.describe.configure({ mode: "serial" });

test.afterEach(async () => {
  const pages = takeCreatedPages();
  const errors = pages.flatMap((p) => pageErrors(p));
  await Promise.all(pages.map((p) => p.context().close()));
  expect(errors, "error console browser").toEqual([]);
});

async function ownerPanel(browser: Parameters<typeof playerPage>[0]) {
  const page = await playerPage(browser, d.owner as Address);
  await page.goto("/me");
  await connect(page);
  const panel = page.getByTestId("spin-owner-panel");
  await expect(panel).toBeVisible();
  return { page, panel };
}

/** Owner: semua peluang 0 kecuali satu hadiah 100%. */
async function setOdds(page: Page, odds: Record<string, string>) {
  for (const [k, v] of Object.entries(odds)) await page.getByTestId(`spin-odds-${k}`).fill(v);
  await page.getByTestId("spin-save").click();
  await expect(page.getByTestId("spin-owner-ok")).toHaveText("Daily Spin settings saved.");
}

const only = (prize: string) => Object.fromEntries(Object.keys(DEFAULT_ODDS).map((k) => [k, k === prize ? "100" : "0"]));

async function spin(page: Page, expected: string) {
  await page.goto("/spin");
  await connect(page);
  await page.getByTestId("spin-button").click();
  const result = page.getByTestId("spin-result");
  await expect(result).toHaveAttribute("data-prize", expected, { timeout: 15_000 });
  await expect(page.getByTestId("spin-done")).toBeVisible();
}

test("Daily Spin: holder menang RIVL, owner publikasi klaim mingguan, holder klaim on-chain", async ({ browser }) => {
  const { page: owner } = await ownerPanel(browser);
  await setOdds(owner, only("rivl_10k"));

  const carol = await playerPage(browser, CAROL);
  await spin(carol, "rivl_10k");
  await expect(carol.getByTestId("odds-rivl_10k")).toHaveText("100%");
  await carol.screenshot({ path: `${SHOTS}/40-spin-won.png`, fullPage: true });

  // Spin kedua di hari yang sama ditolak (tombol tidak ada lagi, server juga menolak).
  await carol.reload();
  await expect(carol.getByTestId("spin-done")).toBeVisible();
  await expect(carol.getByTestId("spin-button")).toHaveCount(0);

  // Owner: siapkan dan publikasikan minggu ini.
  await owner.getByTestId("spin-prepare").click();
  await expect(owner.getByTestId("spin-owner-ok")).toContainText("ready");
  await owner.getByTestId("spin-publish").click();
  await expect(owner.getByText(/Publish week #\d+.*confirmed|confirmed/i).first()).toBeVisible({ timeout: 15_000 });

  // Carol klaim dari /me.
  const before = await balanceOf(CAROL, RIVL);
  await carol.goto("/me");
  const claim = carol.getByTestId("weekly-claim");
  await expect(claim).toContainText("10,000 RIVL", { timeout: 15_000 });
  await carol.getByTestId("claim-rewards").click();
  await expect.poll(() => balanceOf(CAROL, RIVL), { timeout: 15_000 }).toBe(before + parseEther("10000"));
  await expect(claim).toContainText("Nothing to claim right now.", { timeout: 15_000 });
});

test("Daily Spin: kosmetik dimenangkan, dipakai, dan tampil di profil", async ({ browser }) => {
  const { page: owner } = await ownerPanel(browser);
  await setOdds(owner, only("cosmetic"));

  const alice = await playerPage(browser, ALICE);
  await spin(alice, "cosmetic");
  await alice.goto("/me#rewards");
  const inv = alice.getByTestId("inventory");
  await expect(inv).toBeVisible();
  const item = inv.locator("[data-testid^=equip-]:not([data-testid=equip-save])").first();
  await item.click();
  await alice.getByTestId("equip-save").click();
  await expect(alice.getByText("Saved — everyone sees your new look in duels.")).toBeVisible();
  // Avatar di header /me memakai kosmetik yang baru dipasang (frame, badge, atau title).
  await expect(
    alice.locator("header [data-frame], header [data-badge], header [data-testid=player-title]").first(),
  ).toBeVisible({ timeout: 10_000 });
  await alice.screenshot({ path: `${SHOTS}/41-cosmetic-equipped.png`, fullPage: true });
});

test("Daily Spin: menang fee-free → fee duel berikutnya yang dimenangkan dikembalikan", async ({ browser }) => {
  const { page: owner } = await ownerPanel(browser);
  await setOdds(owner, only("fee_free_1"));

  const bob = await playerPage(browser, BOB);
  await spin(bob, "fee_free_1");
  await bob.goto("/me#rewards");
  await expect(bob.getByTestId("rewards-vouchers")).toHaveText("1");

  // Bob (Paper) mengalahkan Alice (Rock): voucher terpakai, fee duel menunggu klaim mingguan.
  await playSuit(ALICE, BOB, 1, 2);
  await expect(bob.getByTestId("rewards-vouchers")).toHaveText("0", { timeout: 30_000 });
  await expect(bob.getByTestId("weekly-claim")).toContainText("Next weekly drop:", { timeout: 15_000 });
  await expect(bob.getByTestId("weekly-claim")).toContainText("ETH");

  // Kembalikan peluang default supaya pengembangan lokal normal.
  await setOdds(owner, DEFAULT_ODDS);
});

test("Daily Spin: wallet dengan RIVL di bawah batas tidak bisa spin", async ({ browser }) => {
  const dave = await playerPage(browser, DAVE);
  await dave.goto("/spin");
  await connect(dave);
  await expect(dave.getByTestId("spin-locked")).toContainText("Hold at least 2,000,000 RIVL");
  await expect(dave.getByTestId("spin-button")).toHaveCount(0);
  await dave.screenshot({ path: `${SHOTS}/42-spin-locked.png`, fullPage: true });
});
