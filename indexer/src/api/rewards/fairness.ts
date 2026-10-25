/**
 * Seed harian commit-reveal: seed(hari) = HMAC-SHA256(SPIN_SECRET, "rivl-spin:" + hari).
 * Hash seed (commit) diumumkan sebelum hari dimulai; seed asli dibuka setelah hari selesai.
 * roll = uint256(keccak256(abi.encode(seed, wallet, hari))) mod 1.000.000 → bisa dicek siapa pun.
 */
import { createHmac } from "node:crypto";
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";

import { rewardsEnv } from "./env";

export const ROLL_SPACE = 1_000_000n;

export function dayOf(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

/** Senin (UTC) minggu itu, "YYYY-MM-DD". */
export function weekOf(unix: number): string {
  const d = new Date(unix * 1000);
  const dow = (d.getUTCDay() + 6) % 7;
  return dayOf(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000));
}

export function nextResetAt(unix: number): number {
  const d = new Date(unix * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
}

export function seedOf(day: string): Hex {
  if (!rewardsEnv.spinSecret) throw new Error("SPIN_SECRET not set");
  return toHex(createHmac("sha256", rewardsEnv.spinSecret).update(`rivl-spin:${day}`).digest());
}

export const commitOf = (seed: Hex) => keccak256(seed);

export function randomOf(seed: Hex, wallet: Address, day: string, salt = ""): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "string" }],
        [seed, wallet, salt ? `${day}:${salt}` : day],
      ),
    ),
  );
}

/** Pesan yang ditandatangani pemain untuk spin hari itu (gratis, tanpa transaksi). */
export const spinMessage = (wallet: Address, day: string) =>
  `Rivl Daily Spin\n\nWallet: ${wallet}\nDay: ${day} (UTC)\n\nSigning is free and does not send a transaction.`;
