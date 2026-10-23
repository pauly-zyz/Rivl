import { expect, test } from "@playwright/test";
import { parseEther, zeroAddress } from "viem";

import { arenaRead, balanceOf, warp } from "./chain";
import { createDuel, expectStatus, joinDuel } from "./ui";
import { connect, deployment, getDuel, pageErrors, playerPage, takeCreatedPages } from "./wallet";

/*
 * Tahap 5: alur lengkap dari browser di chain lokal yang belum dicakup play.spec.ts —
 * Suit timeout, cancel duel, dan claim (dicek terhadap saldo dompet di chain).
 * Coinflip ETH, Dice USDG (approve), dan Suit sampai reveal ada di play.spec.ts.
 */

const SHOTS = "e2e-screens";
const d = deployment();
const [ALICE, BOB] = d.testAccounts as [`0x${string}`, `0x${string}`];

test.describe.configure({ mode: "serial" });

test.afterEach(async () => {
  const pages = takeCreatedPages();
  const errors = pages.flatMap((p) => pageErrors(p));
  await Promise.all(pages.map((p) => p.context().close()));
  expect(errors, "error console browser").toEqual([]);
});

test("Suit timeout: pembuat tidak reveal, penantang mengklaim kemenangan", async ({ browser }) => {
  const alice = await playerPage(browser, ALICE);
  const bob = await playerPage(browser, BOB);
  await alice.goto("/");
  await connect(alice);
  await bob.goto("/");
  await connect(bob);

  const id = await createDuel(alice, { game: "Suit", token: "ETH", amount: "0.01", pick: "Rock" });
  await joinDuel(bob, id, { token: "ETH", pick: "Paper" });
  await expectStatus(bob, "AwaitingReveal");

  // Sebelum batas waktu: penantang hanya bisa menunggu.
  await expect(bob.getByText("Waiting for the creator to reveal.")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Claim timeout win" })).toHaveCount(0);

  // Waktu chain melewati jendela reveal.
  const revealWindow = await arenaRead<bigint>("revealWindow");
  await warp(Number(revealWindow) + 1);

  await bob.reload();
  await expect(bob.getByText("Reveal window closed.")).toBeVisible();
  await bob.screenshot({ path: `${SHOTS}/30-suit-timeout-claimable.png`, fullPage: true });
  await bob.getByRole("button", { name: "Claim timeout win" }).click();
  await expectStatus(bob, "Settled");
  await expect(bob.getByTestId("duel-result")).toContainText("You won");
  await expect(bob.getByTestId("duel-result")).toContainText("didn't reveal in time");

  const chain = await getDuel(id);
  expect(chain.winner.toLowerCase()).toBe(BOB.toLowerCase());
  expect(chain.creatorChoice).toBe(0); // tidak pernah di-reveal
  expect(chain.salt).toBe(`0x${"0".repeat(64)}`);

  // Pembuat melihat kekalahannya; banner reveal untuk duel ini hilang.
  await alice.goto(`/duel/${id}`);
  await expect(alice.getByTestId("duel-result")).toContainText("You lost");
  await expect(alice.getByTestId("reveal-banner").getByText(new RegExp(`Suit #${id}$`))).toHaveCount(0);

  // /fair menjelaskan kemenangan lewat timeout.
  await bob.goto(`/fair?id=${id}`);
  await expect(bob.getByTestId("verify-verdict")).toHaveAttribute("data-verified", "true");
  await expect(bob.getByTestId("verify-steps")).toContainText("rival wins by timeout");
});

test("cancel duel: hanya pembuat yang bisa membatalkan, stake kembali lewat claim", async ({ browser }) => {
  const alice = await playerPage(browser, ALICE);
  const bob = await playerPage(browser, BOB);
  await alice.goto("/");
  await connect(alice);
  await bob.goto("/");
  await connect(bob);

  const usdg = d.contracts.usdg;
  const id = await createDuel(alice, { game: "Coinflip", token: "USDG", amount: "3", pick: "Tails" });
  await expectStatus(alice, "Open");

  // Orang lain tidak melihat tombol Cancel.
  await bob.goto(`/duel/${id}`);
  await expect(bob.getByRole("button", { name: "Join duel" })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Cancel duel" })).toHaveCount(0);

  await alice.getByRole("button", { name: "Cancel duel" }).click();
  await expectStatus(alice, "Cancelled");
  await expect(alice.getByTestId("duel-result")).toContainText("Cancelled by the creator");

  // Duel hilang dari lobby dan tidak bisa diterima lagi.
  await bob.goto("/");
  await expect(bob.getByTestId(`duel-card-${id}`)).toHaveCount(0);
  await bob.goto(`/duel/${id}`);
  await expect(bob.getByRole("button", { name: "Join duel" })).toHaveCount(0);

  // Claim dari halaman duel: seluruh saldo claimable USDG pindah ke dompet.
  const claimable = await arenaRead<bigint>("claimable", [ALICE, usdg]);
  expect(claimable).toBeGreaterThanOrEqual(3_000_000n);
  const before = await balanceOf(ALICE, usdg);
  await alice.screenshot({ path: `${SHOTS}/31-cancelled.png`, fullPage: true });
  await alice.getByRole("button", { name: /^Claim / }).click();
  await expect(alice.getByRole("button", { name: /^Claim / })).toHaveCount(0);
  expect(await arenaRead<bigint>("claimable", [ALICE, usdg])).toBe(0n);
  expect((await balanceOf(ALICE, usdg)) - before).toBe(claimable);
});

test("claim ETH dari My duels: saldo dompet bertambah sebesar klaim (dikurangi gas)", async ({ browser }) => {
  const bob = await playerPage(browser, BOB);
  await bob.goto("/me");
  await connect(bob);

  const claimable = await arenaRead<bigint>("claimable", [BOB, zeroAddress]);
  test.skip(claimable === 0n, "bob tidak punya saldo ETH untuk diklaim");
  const before = await balanceOf(BOB, "ETH");

  const row = bob.getByTestId("claimable-ETH");
  await row.getByRole("button", { name: "Claim" }).click();
  await expect(row.getByRole("button", { name: "Claim" })).toBeDisabled();

  expect(await arenaRead<bigint>("claimable", [BOB, zeroAddress])).toBe(0n);
  const gained = (await balanceOf(BOB, "ETH")) - before;
  expect(gained).toBeLessThanOrEqual(claimable);
  expect(gained).toBeGreaterThan(claimable - parseEther("0.001")); // gas lokal jauh di bawah 0.001 ETH
  await bob.screenshot({ path: `${SHOTS}/32-claimed-eth.png`, fullPage: true });
});
