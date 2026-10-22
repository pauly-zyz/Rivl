import { expect, type Page } from "@playwright/test";

/** Langkah UI yang dipakai beberapa spec: buat duel, terima duel, cek status. */

export async function createDuel(
  page: Page,
  opts: { game: "Coinflip" | "Dice Duel" | "Suit"; token: "ETH" | "USDG"; amount: string; pick?: string },
): Promise<bigint> {
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "Create duel" }).click();
  const dialog = page.getByRole("dialog", { name: "Create duel" });
  await dialog.getByRole("button", { name: opts.game, exact: true }).click();
  await dialog.getByRole("button", { name: new RegExp(`^${opts.token}`) }).click();
  await dialog.getByLabel("Stake amount").fill(opts.amount);
  if (opts.pick) await dialog.getByRole("button", { name: opts.pick, exact: true }).click();
  if (opts.token === "USDG") {
    const approve = dialog.getByRole("button", { name: "Approve USDG" });
    if (await approve.isVisible()) await approve.click();
  }
  await dialog.getByRole("button", { name: "Create duel" }).click();
  await page.waitForURL(/\/duel\/\d+$/);
  return BigInt(page.url().split("/").pop()!);
}

export async function joinDuel(page: Page, id: bigint, opts: { token: "ETH" | "USDG"; pick?: string }) {
  await page.goto(`/duel/${id}`);
  await page.getByRole("button", { name: "Join duel" }).click();
  const dialog = page.getByRole("dialog", { name: `Join duel #${id}` });
  if (opts.pick) await dialog.getByRole("button", { name: opts.pick, exact: true }).click();
  if (opts.token === "USDG") {
    const approve = dialog.getByRole("button", { name: "Approve USDG" });
    await expect(approve.or(dialog.getByRole("button", { name: /^Join for/ }))).toBeVisible();
    if (await approve.isVisible()) await approve.click();
  }
  await dialog.getByRole("button", { name: /^Join for/ }).click();
  await expect(dialog).toBeHidden();
}

export async function expectStatus(page: Page, status: string | RegExp) {
  await expect(page.getByTestId("duel-status")).toHaveAttribute("data-status", status);
}

