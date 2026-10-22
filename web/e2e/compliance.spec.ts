import { expect, test } from "@playwright/test";

import { COMING_SOON } from "../src/lib/comingSoon";
import { parseBlockedCountries } from "../src/lib/geo";
import { freshAccount, playRandomDuel, playSuit } from "./chain";
import { connect, deployment, pageErrors, playerPage, takeCreatedPages } from "./wallet";

/*
 * Tahap 4: age gate, geoblock, footer, Coming Soon, batas pribadi, dan /fair.
 */

const SHOTS = "e2e-screens";
const d = deployment();
const [ALICE, BOB] = d.testAccounts as [`0x${string}`, `0x${string}`];

test.describe.configure({ mode: "serial" });

/** Setiap halaman yang dibuka test ini harus bebas error console; context ditutup supaya tidak jalan di latar. */
test.afterEach(async () => {
  const pages = takeCreatedPages();
  const errors = pages.flatMap((p) => pageErrors(p));
  await Promise.all(pages.map((p) => p.context().close()));
  expect(errors, "error console browser").toEqual([]);
});


test("age gate: wajib 18+ dan setuju Terms; Terms tetap bisa dibaca", async ({ browser }) => {
  const page = await playerPage(browser, ALICE, { width: 375, height: 812 }, { ageGate: "show" });
  await page.goto("/");
  const gate = page.getByTestId("age-gate");
  await expect(gate).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/20-age-gate-mobile.png` });

  const enter = gate.getByRole("button", { name: "Enter Rivl" });
  await expect(enter).toBeDisabled();
  await gate.getByLabel(/I am 18 years or older/).check();
  await expect(enter).toBeDisabled(); // Terms belum disetujui

  // Terms bisa dibuka dari dalam gate tanpa terhalang gate.
  await gate.getByRole("link", { name: "Terms" }).click();
  await page.waitForURL("**/terms");
  await expect(page.getByTestId("legal-placeholder")).toContainText("TO BE PROVIDED BY LEGAL COUNSEL");
  await expect(page.getByTestId("age-gate")).toHaveCount(0);

  await page.goto("/");
  await gate.getByLabel(/I am 18 years or older/).check();
  await gate.getByLabel(/I agree to the/).check();
  await enter.click();
  await expect(gate).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Find your rival/ })).toBeVisible();
  await expect(page.getByTestId("age-gate")).toHaveCount(0);

  // Pengunjung di bawah umur tidak bisa masuk.
  const minor = await playerPage(browser, ALICE, undefined, { ageGate: "show" });
  await minor.goto("/");
  await minor.getByRole("button", { name: "I'm under 18" }).click();
  await expect(minor.getByTestId("age-gate")).toContainText("only for adults aged 18 and over");
});

test("geoblock default: semua negara boleh akses", async ({ browser }) => {
  test.skip(parseBlockedCountries(process.env.BLOCKED_COUNTRIES).size > 0, "BLOCKED_COUNTRIES diisi");
  for (const [header, country] of [
    ["cf-ipcountry", "ID"],
    ["x-vercel-ip-country", "US"],
  ] as const) {
    const page = await playerPage(browser, ALICE, undefined, { headers: { [header]: country } });
    const res = await page.goto("/");
    expect(res?.status(), `/ dari ${country}`).toBe(200);
    await expect(page.getByRole("heading", { name: /Find your rival/ })).toBeVisible();
  }
});

test("geoblock: negara di BLOCKED_COUNTRIES melihat 'Not available in your region'", async ({ browser }) => {
  const blocked = [...parseBlockedCountries(process.env.BLOCKED_COUNTRIES)];
  test.skip(blocked.length === 0, "BLOCKED_COUNTRIES kosong: tidak ada negara yang diblokir");
  const allowed = ["DE", "GB", "SG", "BR", "JP"].find((c) => !blocked.includes(c))!;

  for (const [header, country] of [
    ["cf-ipcountry", blocked[0]!],
    ["x-vercel-ip-country", blocked[blocked.length - 1]!],
  ] as const) {
    const page = await playerPage(browser, ALICE, { width: 375, height: 812 }, { headers: { [header]: country } });
    for (const path of ["/", "/me", "/duel/1", "/fair"]) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} dari ${country}`).toBe(451);
      await expect(page.getByRole("heading", { name: "Not available in your region" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);
    }
    await page.screenshot({ path: `${SHOTS}/21-geoblocked-${country}.png` });
  }

  const ok = await playerPage(browser, ALICE, undefined, { headers: { "cf-ipcountry": allowed } });
  const res = await ok.goto("/");
  expect(res?.status()).toBe(200);
  await expect(ok.getByRole("heading", { name: /Find your rival/ })).toBeVisible();
});

test("footer peringatan risiko dan kartu Coming Soon", async ({ browser }) => {
  const page = await playerPage(browser, ALICE);
  await page.goto("/");
  const footer = page.getByTestId("footer");
  await expect(footer).toContainText("18+ only");
  await expect(footer).toContainText("you can lose your entire stake");

  const cards = page.getByTestId("coming-soon-card");
  await expect(cards).toHaveCount(COMING_SOON.length);
  for (const [i, f] of COMING_SOON.entries()) {
    await expect(cards.nth(i)).toContainText(f.name);
    await expect(cards.nth(i)).toContainText(f.text);
  }
  const xUrl = process.env.NEXT_PUBLIC_X_URL;
  const notify = cards.first().getByText("Notify me");
  if (xUrl) await expect(notify).toHaveAttribute("href", xUrl);
  else await expect(notify).toHaveAttribute("aria-disabled", "true");
  await cards.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/22-coming-soon.png`, fullPage: true });

  for (const [name, heading] of [
    ["Terms", "Terms"],
    ["Responsible gaming", "Responsible gaming"],
  ] as const) {
    await footer.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByTestId("legal-placeholder")).toContainText("TO BE PROVIDED BY LEGAL COUNSEL");
  }
});

test("batas harian: taruhan di atas sisa batas 24 jam ditolak; menaikkan batas tertunda 24 jam", async ({ browser }) => {
  const page = await playerPage(browser, await freshAccount());
  await page.goto("/me");
  await connect(page);

  const eth = page.getByTestId("limit-ETH");
  await eth.getByLabel("Daily limit in ETH").fill("0.01");
  await eth.getByRole("button", { name: "Set limit" }).click();
  await expect(eth).toContainText("Limit 0.01 ETH");

  // Taruhan pertama 0.01 ETH masih di dalam batas.
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "Create duel" }).click();
  let dialog = page.getByRole("dialog", { name: "Create duel" });
  await dialog.getByLabel("Stake amount").fill("0.01");
  await expect(dialog).toContainText("Daily limit: 0.01 of 0.01 ETH left");
  await dialog.getByRole("button", { name: "Create duel" }).click();
  await page.waitForURL(/\/duel\/\d+$/);

  // Taruhan berikutnya melewati batas (menunggu indexer mencatat taruhan pertama).
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "Create duel" }).click();
  dialog = page.getByRole("dialog", { name: "Create duel" });
  await dialog.getByLabel("Stake amount").fill("0.005");
  await expect(dialog).toContainText("over your daily limit");
  await expect(dialog.getByRole("button", { name: "Create duel" })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/23-daily-limit-blocked.png` });

  // Menaikkan batas tidak langsung berlaku.
  await page.goto("/me");
  await eth.getByLabel("Daily limit in ETH").fill("1");
  await eth.getByRole("button", { name: "Set limit" }).click();
  await expect(eth).toContainText("Limit 0.01 ETH");
  await expect(eth).toContainText("Change to 1 ETH takes effect");
  await eth.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/24-limits.png`, fullPage: true });
});

test("take a break: Create/Join tersembunyi, klaim tetap ada", async ({ browser }) => {
  // Duel terbuka milik orang lain, untuk memastikan tombol Join ikut tersembunyi.
  const host = await playerPage(browser, ALICE);
  await host.goto("/");
  await connect(host);
  await host.getByRole("main").getByRole("button", { name: "Create duel" }).click();
  const create = host.getByRole("dialog", { name: "Create duel" });
  await create.getByLabel("Stake amount").fill("0.001");
  await create.getByRole("button", { name: "Create duel" }).click();
  await host.waitForURL(/\/duel\/\d+$/);
  const openId = host.url().split("/").pop()!;

  const page = await playerPage(browser, await freshAccount(), { width: 375, height: 812 });
  await page.goto("/me");
  await connect(page);
  await page.getByRole("radio", { name: "24 hours" }).click();
  await page.getByRole("button", { name: "Take a break" }).click();
  await page.getByRole("button", { name: "Start 24 hours break" }).click();
  await expect(page.getByTestId("personal-limits").getByTestId("break-notice")).toBeVisible();
  await expect(page.getByTestId("claimable-ETH")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("main").getByTestId("break-notice")).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Create duel" })).toHaveCount(0);
  const card = page.getByTestId(`duel-card-${openId}`).locator("..");
  await expect(card.getByRole("link", { name: "View" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Join" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/25-break-lobby-mobile.png`, fullPage: true });

  await page.goto(`/duel/${openId}`);
  await expect(page.getByTestId("break-notice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join duel" })).toHaveCount(0);
});

test("/fair: verifikasi Coinflip, Dice, dan Suit dari data on-chain", async ({ browser }) => {
  const coin = await playRandomDuel("Coinflip", ALICE, BOB);
  const dice = await playRandomDuel("Dice", BOB, ALICE);
  const suit = await playSuit(ALICE, BOB, 3, 2); // Scissors vs Paper

  const page = await playerPage(browser, ALICE);
  await page.goto("/fair");
  await expect(page.getByTestId("randomness-source")).toHaveAttribute("data-kind", "dev");
  await expect(page.getByTestId("randomness-source")).toContainText("not");

  // Lewat form.
  await page.getByLabel("Duel ID").fill(coin.toString());
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(`**/fair?id=${coin}`);
  await expect(page.getByTestId("verify-verdict")).toHaveAttribute("data-verified", "true");
  await expect(page.getByTestId("verify-steps")).toContainText("randomWord % 2");

  for (const [id, text] of [
    [dice, "lower 128 bits % 100 + 1"],
    [suit, "equals the commit"],
  ] as const) {
    await page.goto(`/fair?id=${id}`);
    await expect(page.getByTestId("verify-verdict")).toHaveAttribute("data-verified", "true");
    await expect(page.getByTestId("verify-steps")).toContainText(text);
    await expect(page.getByTestId("verify-steps")).not.toContainText("mismatch");
  }
  await page.screenshot({ path: `${SHOTS}/26-fair-suit.png`, fullPage: true });

  await page.goto("/fair?id=999999");
  await expect(page.getByTestId("verify-not-found")).toBeVisible();
});
