#!/usr/bin/env node
// Ekspor ABI dari artefak Foundry ke abi/:
//   <Nama>.json   — ABI mentah
//   <Nama>.ts     — `export const <nama>Abi = [...] as const` (untuk viem/wagmi/Ponder)
//   index.ts      — re-export semua ABI
//
// Pakai:   forge build && node script/export-abi.mjs
// Cek CI:  node script/export-abi.mjs --check   (gagal jika file di abi/ tidak sama dengan hasil build)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "abi");
const check = process.argv.includes("--check");

const CONTRACTS = [{ name: "DuelArena", source: "DuelArena.sol", constName: "duelArenaAbi" }];

const HEADER = "// File ini dibuat otomatis oleh contracts/script/export-abi.mjs. Jangan diedit manual.\n";
const files = {};

for (const { name, source, constName } of CONTRACTS) {
  const artifact = join(root, "out", source, `${name}.json`);
  if (!existsSync(artifact)) {
    console.error(`Artefak tidak ditemukan: ${artifact}\nJalankan "forge build" dulu.`);
    process.exit(1);
  }
  const { abi } = JSON.parse(readFileSync(artifact, "utf8"));
  files[`${name}.json`] = JSON.stringify(abi, null, 2) + "\n";
  files[`${name}.ts`] = HEADER + `export const ${constName} = ${JSON.stringify(abi, null, 2)} as const;\n`;
}

files["index.ts"] =
  HEADER + CONTRACTS.map(({ name, constName }) => `export { ${constName} } from "./${name}";\n`).join("");

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
  console.log(`ABI ditulis ke abi/: ${Object.keys(files).join(", ")}`);
}
