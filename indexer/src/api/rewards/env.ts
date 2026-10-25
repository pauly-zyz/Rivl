/**
 * Konfigurasi Daily Spin dari .env (indexer). Semua opsional: tanpa token RIVL atau SPIN_SECRET,
 * spin hanya tampil "belum dibuka" dan endpoint lain tetap jalan.
 *
 *   RIVL_TOKEN_ADDRESS       alamat token RIVL (isi saat token sudah launch)
 *   RIVL_TOKEN_START_BLOCK   blok deploy token (awal pencatatan saldo holder)
 *   REWARDS_ADDRESS          alamat contract RivlRewards (klaim mingguan)
 *   SPIN_SECRET              rahasia acak panjang untuk seed harian (commit-reveal); jangan pernah dibagikan
 *   DATABASE_URL             PostgreSQL (data spin disimpan di schema "rivl_rewards"); tanpa ini: PGlite lokal
 *
 * Chain/RPC sama dengan indexer (INDEXER_CHAIN, ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC, atau deployments/local.json).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, isAddress, type Address } from "viem";

const repoRoot = join(process.cwd(), "..");
const val = (name: string) => process.env[name]?.trim() || undefined;

export type RewardsEnv = {
  mode: "local" | "testnet" | "mainnet";
  chainId: number;
  rpc: string;
  rivl?: Address;
  rivlStartBlock: bigint;
  rewards?: Address;
  arena?: Address;
  spinSecret?: string;
  databaseUrl?: string;
  dataDir: string;
};

function load(): RewardsEnv {
  const mode = (val("INDEXER_CHAIN") ?? "local") as RewardsEnv["mode"];
  const base = { databaseUrl: val("DATABASE_URL"), dataDir: join(process.cwd(), ".ponder", "rewards") };
  if (mode === "local") {
    const file = join(repoRoot, "deployments", "local.json");
    const d = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as {
          chainId: number;
          rpcUrl: string;
          startBlock: number;
          contracts: { arena: Address; rivl?: Address; rewards?: Address };
        })
      : undefined;
    return {
      ...base,
      mode,
      chainId: d?.chainId ?? 31337,
      rpc: d?.rpcUrl ?? "http://127.0.0.1:8545",
      rivl: d?.contracts.rivl,
      rivlStartBlock: BigInt(d?.startBlock ?? 0),
      rewards: d?.contracts.rewards,
      arena: d?.contracts.arena,
      spinSecret: val("SPIN_SECRET") ?? "local-dev-spin-secret",
    };
  }
  const prefix = mode === "testnet" ? "ROBINHOOD_TESTNET" : "ROBINHOOD";
  const addr = (name: string) => {
    const v = val(name);
    return v && isAddress(v) ? getAddress(v) : undefined;
  };
  return {
    ...base,
    mode,
    chainId: Number(val(`${prefix}_CHAIN_ID`) ?? 0),
    rpc: val(`${prefix}_RPC`) ?? "",
    rivl: addr("RIVL_TOKEN_ADDRESS"),
    rivlStartBlock: BigInt(val("RIVL_TOKEN_START_BLOCK") ?? 0),
    rewards: addr("REWARDS_ADDRESS"),
    arena: addr("ARENA_ADDRESS"),
    spinSecret: val("SPIN_SECRET"),
  };
}

export const rewardsEnv = load();
