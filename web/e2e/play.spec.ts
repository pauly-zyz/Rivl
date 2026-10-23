import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { createDuel, expectStatus, joinDuel } from "./ui";
import { connect, deployment, getDuel, pageErrors, playerPage, takeCreatedPages } from "./wallet";

/*
 * Bukti Tahap 3: ketiga game dimainkan dari browser di chain lokal, oleh dua pemain di dua browser context.
 * Setiap hasil yang tampil di halaman dicocokkan dengan getDuel() di chain.
 */

const STATUS = ["None", "Open", "AwaitingReveal", "Settled", "Draw", "Cancelled"];
const SHOTS = "e2e-screens";

const d = deployment();
const [ALICE, BOB] = d.testAccounts as [`0x${string}`, `0x${string}`];

/**
 * Poin 4: hasil tidak pernah tampil sebelum ada di chain. Ambil sampel halaman berulang kali;
 * state chain dibaca SETELAH tiap sampel, jadi jika halaman sudah menampilkan hasil, chain harus sudah final.
 */
async function assertNoEarlyResult(page: Page, id: bigint, testId: "coin" | "dice" | "suit") {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const phase = await page.getByTestId(testId).getAttribute("data-phase");
    const status = STATUS[(await getDuel(id)).status]!;
    seen.add(phase ?? "");
    if (phase === "result") expect(["Settled", "Draw"]).toContain(status);
    if (phase === "result" || status === "Settled" || status === "Draw") break;
    await page.waitForTimeout(150);
  }
  return seen;
}

test.describe.configure({ mode: "serial" });

/** Setiap halaman yang dibuka test ini harus bebas error console; context ditutup supaya tidak jalan di latar. */
test.afterEach(async () => {
  const pages = takeCreatedPages();
  const errors = pages.flatMap((p) => pageErrors(p));
  await Promise.all(pages.map((p) => p.context().close()));
  expect(errors, "error console browser").toEqual([]);
});



test("Coinflip dengan ETH: buat, terima, reveal, hasil dari rahasia kedua pemain", async ({ browser }) => {
  const alice = await playerPage(browser, ALICE);
  const bob = await playerPage(browser, BOB);
  await alice.goto("/");
  await connect(alice);
  await bob.goto("/");
  await connect(bob);

  const id = await createDuel(alice, { game: "Coinflip", token: "ETH", amount: "0.01", pick: "Heads" });
  await expectStatus(alice, "Open");
  await alice.screenshot({ path: `${SHOTS}/01-coinflip-open.png`, fullPage: true });

  // Duel muncul di lobby bob.
  await bob.goto("/");
  await expect(bob.getByTestId(`duel-card-${id}`)).toBeVisible();

  await joinDuel(bob, id, { token: "ETH" });
  await expectStatus(bob, "AwaitingReveal");
  await expect(bob.getByTestId("coin")).toHaveAttribute("data-phase", "waiting");

  // Rahasia Coinflip tersimpan di browser alice dengan commit yang sama di chain (move 0).
  const chainCommit = (await getDuel(id)).commit;
  const stored = await alice.evaluate(() => JSON.parse(localStorage.getItem("rivl:suit-secrets:v1") ?? "[]"));
  expect(stored.find((s: { commit: string }) => s.commit === chainCommit.toLowerCase())).toMatchObject({ move: 0, duelId: id.toString() });

  await alice.goto(`/duel/${id}`);
  await alice.getByRole("button", { name: "Reveal & flip" }).click();
  const phases = await assertNoEarlyResult(alice, id, "coin");
  await expectStatus(alice, "Settled");
  await expectStatus(bob, "Settled");

  const chain = await getDuel(id);
  const aliceWon = chain.winner.toLowerCase() === ALICE.toLowerCase();
  await expect(alice.getByTestId("coin")).toHaveAttribute("data-result", String(chain.creatorResult));
  await expect(alice.getByTestId("duel-result")).toContainText(aliceWon ? "You won" : "You lost");
  await expect(bob.getByTestId("duel-result")).toContainText(aliceWon ? "You lost" : "You won");
  await alice.waitForTimeout(1600); // animasi mendarat selesai
  await alice.screenshot({ path: `${SHOTS}/02-coinflip-settled.png`, fullPage: true });
  console.log(`Coinflip #${id}: hasil ${chain.creatorResult === 0 ? "HEADS" : "TAILS"}, pemenang ${aliceWon ? "alice" : "bob"}; fase terlihat: ${[...phases].join(" → ")}`);
});

test("Dice Duel dengan USDG: approve, buat, terima, angka sama dengan chain", async ({ browser }) => {
  const alice = await playerPage(browser, ALICE);
  const bob = await playerPage(browser, BOB);
  await alice.goto("/");
  await connect(alice);
  await bob.goto("/");
  await connect(bob);

  const id = await createDuel(alice, { game: "Dice Duel", token: "USDG", amount: "5" });
  await joinDuel(bob, id, { token: "USDG" });
  await expectStatus(bob, "AwaitingReveal");
  await bob.screenshot({ path: `${SHOTS}/03-dice-rolling.png`, fullPage: true });

  // Banner reveal juga muncul untuk Dice.
  await alice.goto("/");
  await expect(alice.getByTestId("reveal-banner")).toContainText(`Dice Duel #${id}`);
  await alice.goto(`/duel/${id}`);
  await alice.getByRole("button", { name: "Reveal & roll" }).click();
  await assertNoEarlyResult(bob, id, "dice");
  await expectStatus(bob, /Settled|Draw/);

  const chain = await getDuel(id);
  await expect(bob.getByTestId("die-creator")).toHaveText(String(chain.creatorResult));
  await expect(bob.getByTestId("die-joiner")).toHaveText(String(chain.joinerResult));
  await bob.screenshot({ path: `${SHOTS}/04-dice-settled.png`, fullPage: true });
  console.log(`Dice #${id}: alice ${chain.creatorResult} vs bob ${chain.joinerResult} → ${STATUS[chain.status]}`);
});

test("Suit: commit di browser, reveal, lalu klaim", async ({ browser }) => {
  const alice = await playerPage(browser, ALICE);
  const bob = await playerPage(browser, BOB);
  await alice.goto("/");
  await connect(alice);
  await bob.goto("/");
  await connect(bob);

  const id = await createDuel(alice, { game: "Suit", token: "ETH", amount: "0.02", pick: "Rock" });

  // Rahasia tersimpan di localStorage dengan commit yang sama persis dengan di chain, plus duelId.
  const chainCommit = (await getDuel(id)).commit;
  const stored = await alice.evaluate(() => JSON.parse(localStorage.getItem("rivl:suit-secrets:v1") ?? "[]"));
  const secret = stored.find((s: { commit: string }) => s.commit === chainCommit.toLowerCase());
  expect(secret).toMatchObject({ move: 1, duelId: id.toString() });

  await joinDuel(bob, id, { token: "ETH", pick: "Paper" });
  await expectStatus(bob, "AwaitingReveal");

  // Banner "You need to reveal" muncul untuk alice di halaman mana pun.
  await alice.goto("/");
  const banner = alice.getByTestId("reveal-banner");
  await expect(banner).toContainText("You need to reveal");
  await expect(banner).toContainText(`Suit #${id}`);
  await alice.screenshot({ path: `${SHOTS}/05-suit-reveal-banner.png`, fullPage: true });
  await expect(bob.getByTestId("suit")).toHaveAttribute("data-phase", "waiting");

  // Simulasikan indexer yang tertinggal: mulai sekarang alice terus menerima daftar pending-reveals lama.
  let stale: string | undefined;
  await alice.route("**/players/*/pending-reveals*", async (route) => {
    if (!stale) stale = await (await route.fetch()).text();
    await route.fulfill({ status: 200, contentType: "application/json", body: stale });
  });

  await banner.getByRole("link", { name: "Reveal now" }).click();
  await alice.waitForURL(`**/duel/${id}`);
  await alice.getByRole("button", { name: "Reveal my move" }).click();
  await expectStatus(alice, "Settled");
  // Duel ini hilang dari banner karena status di chain sudah final, walaupun indexer belum mengejar.
  // (Duel lain dari run sebelumnya boleh masih ada.)
  expect(stale).toContain(`"id":"${id}"`);
  await expect(alice.getByTestId("reveal-banner").getByText(new RegExp(`Suit #${id}$`))).toHaveCount(0, { timeout: 5_000 });
  await alice.unroute("**/players/*/pending-reveals*");

  const chain = await getDuel(id);
  expect(chain.winner.toLowerCase()).toBe(BOB.toLowerCase()); // Paper > Rock
  await expect(bob.getByTestId("duel-result")).toContainText("You won");
  await bob.screenshot({ path: `${SHOTS}/06-suit-settled.png`, fullPage: true });

  // Bob mengklaim kemenangan dari /me.
  await bob.goto("/me");
  const row = bob.getByTestId("claimable-ETH");
  await expect(row.getByRole("button", { name: "Claim" })).toBeEnabled();
  await row.getByRole("button", { name: "Claim" }).click();
  await expect(row).toContainText(/^ETH\s*0\s*Claim$/);
  await bob.screenshot({ path: `${SHOTS}/07-me-claimed.png`, fullPage: true });
});

test("Suit: backup di satu browser, restore di browser lain, lalu reveal", async ({ browser }) => {
  const alice = await playerPage(browser, ALICE);
  const bob = await playerPage(browser, BOB);
  await alice.goto("/");
  await connect(alice);
  await bob.goto("/");
  await connect(bob);

  const id = await createDuel(alice, { game: "Suit", token: "ETH", amount: "0.01", pick: "Scissors" });
  await joinDuel(bob, id, { token: "ETH", pick: "Paper" });

  await alice.goto("/me");
  const downloadPromise = alice.waitForEvent("download");
  await alice.getByRole("button", { name: "Back up (download)" }).click();
  const file = await (await downloadPromise).path();
  expect(JSON.parse(readFileSync(file, "utf8")).type).toBe("rivl-suit-secrets"); // format tetap, supaya backup lama bisa dipulihkan

  // Browser baru (localStorage kosong): tidak bisa reveal sampai backup dipulihkan.
  const fresh = await playerPage(browser, ALICE, { width: 375, height: 812 });
  await fresh.goto(`/duel/${id}`);
  await connect(fresh);
  await expect(fresh.getByText("Your secret for this duel isn't saved in this browser")).toBeVisible();
  await expect(fresh.getByTestId("reveal-banner")).toContainText("Restore your backup");
  await expect(fresh.getByRole("button", { name: "Reveal my move" })).toHaveCount(0);
  await fresh.screenshot({ path: `${SHOTS}/08-mobile-secret-missing.png`, fullPage: true });

  await fresh.goto("/me");
  await fresh.getByTestId("restore-input").setInputFiles(file);
  await expect(fresh.getByText(/Restored \d+ secrets?\./)).toBeVisible();
  await fresh.screenshot({ path: `${SHOTS}/09-mobile-me-restored.png`, fullPage: true });

  await fresh.goto(`/duel/${id}`);
  await fresh.getByRole("button", { name: "Reveal my move" }).click();
  await expectStatus(fresh, "Settled");
  const chain = await getDuel(id);
  expect(chain.winner.toLowerCase()).toBe(ALICE.toLowerCase()); // Scissors > Paper
  await expect(fresh.getByTestId("duel-result")).toContainText("You won");
  await fresh.screenshot({ path: `${SHOTS}/10-mobile-suit-won.png`, fullPage: true });
});

test("Tampilan 375px: lobby dan modal Create rapi tanpa scroll horizontal", async ({ browser }) => {
  const page = await playerPage(browser, ALICE, { width: 375, height: 812 });
  await page.goto("/");
  await connect(page);
  await expect(page.getByText("Live results")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/11-mobile-lobby.png`, fullPage: true });
  await page.getByRole("main").getByRole("button", { name: "Create duel" }).click();
  await page.getByRole("dialog", { name: "Create duel" }).getByRole("button", { name: "Suit", exact: true }).click();
  await page.screenshot({ path: `${SHOTS}/12-mobile-create.png` });
});
