#!/usr/bin/env node
// Ekspor ABI DuelArena dari artefak Foundry ke:
//   abi/DuelArena.json   — ABI mentah (untuk indexer / tool lain)
//   abi/DuelArena.ts     — `export const duelArenaAbi = [...] as const` (untuk viem/wagmi/Ponder)
//
// Pakai:   forge build && node script/export-abi.mjs
// Cek CI:  node script/export-abi.mjs --check   (gagal jika file di abi/ tidak sama dengan hasil build)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = join(root, "out", "DuelArena.sol", "DuelArena.json");
const outDir = join(root, "abi");
const check = process.argv.includes("--check");

if (!existsSync(artifact)) {
  console.error(`Artefak tidak ditemukan: ${artifact}\nJalankan "forge build" dulu.`);
  process.exit(1);
}

const { abi } = JSON.parse(readFileSync(artifact, "utf8"));
const json = JSON.stringify(abi, null, 2) + "\n";
const ts =
  "// File ini dibuat otomatis oleh contracts/script/export-abi.mjs. Jangan diedit manual.\n" +
  `export const duelArenaAbi = ${JSON.stringify(abi, null, 2)} as const;\n`;

const files = { "DuelArena.json": json, "DuelArena.ts": ts };

if (check) {
  const stale = Object.entries(files).filter(([name, content]) => {
    const p = join(outDir, name);
    return !existsSync(p) || readFileSync(p, "utf8") !== content;
  });
  if (stale.length) {
    console.error(`ABI usang: ${stale.map(([n]) => n).join(", ")}. Jalankan "node script/export-abi.mjs".`);
    process.exit(1);
  }
  console.log("ABI up to date.");
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(outDir, name), content);
  console.log(`ABI DuelArena (${abi.length} entri) ditulis ke abi/DuelArena.json dan abi/DuelArena.ts`);
}
