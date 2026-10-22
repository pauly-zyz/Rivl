import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONTRACTS_DIR = join(REPO_ROOT, "contracts");
export const INDEXER_DIR = join(REPO_ROOT, "indexer");
export const DEV_DIR = join(REPO_ROOT, ".dev");

let loaded = false;

/** Muat `.env` di root repo (jika ada). Variabel yang sudah di-set di shell tidak ditimpa. */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = join(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function envString(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function requireEnv(name: string, hint: string): string {
  const v = envString(name);
  if (!v) throw new Error(`Variabel ${name} belum diisi di .env. ${hint}`);
  return v;
}

export function envInt(name: string, fallback: number): number {
  const v = envString(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} harus bilangan bulat >= 0, dapat "${v}"`);
  return n;
}

/** Cari binary Foundry di PATH, lalu di ~/.foundry/bin. */
export function findFoundryBin(name: "anvil" | "forge"): string {
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".foundry", "bin")];
  for (const dir of dirs) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  throw new Error(
    `"${name}" tidak ditemukan. Pasang Foundry: https://book.getfoundry.sh/getting-started/installation`,
  );
}
