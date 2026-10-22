/**
 * Konfigurasi chain dipilih lewat INDEXER_CHAIN di .env root:
 *
 *   local    Anvil dari `pnpm dev`. Alamat & blok awal dari deployments/local.json.
 *   testnet  ROBINHOOD_TESTNET_CHAIN_ID, ROBINHOOD_TESTNET_RPC, ARENA_ADDRESS, ARENA_START_BLOCK
 *   mainnet  ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC, ARENA_ADDRESS, ARENA_START_BLOCK
 *
 * Chain ID, RPC, dan alamat TIDAK punya nilai default untuk testnet/mainnet: isi dari dokumentasi
 * resmi Robinhood Chain dan hasil deploy. Jika kosong, indexer berhenti dengan pesan jelas.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConfig } from "ponder";
import { getAddress, type Address } from "viem";
import { duelArenaAbi } from "@rivl/contracts/abi";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootEnv = join(repoRoot, ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function required(name: string): string {
  const v = env(name);
  if (!v) {
    throw new Error(
      `[indexer] ${name} belum diisi di .env (INDEXER_CHAIN=${env("INDEXER_CHAIN")}). ` +
        "Ambil dari dokumentasi resmi Robinhood Chain atau hasil deploy; jangan mengarang.",
    );
  }
  return v;
}

function int(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`[indexer] ${name} harus bilangan bulat, dapat "${value}"`);
  return n;
}

type Target = {
  chainName: string;
  chainId: number;
  rpc: string;
  address: Address;
  startBlock: number;
  /** Anvil di-reset setiap `pnpm dev`, jadi data RPC tidak boleh di-cache. */
  cacheRpcRequests: boolean;
};

function resolveTarget(): Target {
  const mode = env("INDEXER_CHAIN") ?? "local";

  if (mode === "local") {
    const file = join(repoRoot, "deployments", "local.json");
    if (!existsSync(file)) {
      throw new Error(`[indexer] ${file} tidak ada. Jalankan chain lokal dulu (pnpm dev).`);
    }
    const d = JSON.parse(readFileSync(file, "utf8")) as {
      chainId: number;
      rpcUrl: string;
      startBlock: number;
      contracts: { arena: Address };
    };
    return {
      chainName: "local",
      chainId: d.chainId,
      rpc: d.rpcUrl,
      address: d.contracts.arena,
      startBlock: d.startBlock,
      cacheRpcRequests: false,
    };
  }

  if (mode === "testnet" || mode === "mainnet") {
    const prefix = mode === "testnet" ? "ROBINHOOD_TESTNET" : "ROBINHOOD";
    return {
      chainName: mode === "testnet" ? "robinhoodTestnet" : "robinhood",
      chainId: int(`${prefix}_CHAIN_ID`, required(`${prefix}_CHAIN_ID`)),
      rpc: required(`${prefix}_RPC`),
      address: getAddress(required("ARENA_ADDRESS")),
      startBlock: int("ARENA_START_BLOCK", required("ARENA_START_BLOCK")),
      cacheRpcRequests: true,
    };
  }

  throw new Error(`[indexer] INDEXER_CHAIN="${mode}" tidak dikenal. Pilih local, testnet, atau mainnet.`);
}

const t = resolveTarget();

// Database: Ponder memakai PostgreSQL jika DATABASE_URL di-set, selain itu PGlite di indexer/.ponder.
export default createConfig({
  chains: {
    [t.chainName]: {
      id: t.chainId,
      rpc: t.rpc,
      cacheRpcRequests: t.cacheRpcRequests,
      ...(t.chainName === "local" ? { pollingInterval: 500 } : {}),
    },
  },
  contracts: {
    DuelArena: {
      chain: t.chainName,
      abi: duelArenaAbi,
      address: t.address,
      startBlock: t.startBlock,
    },
  },
});
