/**
 * `pnpm deploy:env [chainId]` — ubah hasil `forge script script/Deploy.s.sol --broadcast` menjadi env siap salin.
 *
 * Membaca contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json, lalu:
 *   - menulis deployments/<network>.json
 *   - mencetak env untuk Railway (indexer, auto-fulfill) dan Vercel (web)
 *
 * Alamat contract, blok deploy, dan alamat USDG diambil dari transaksi yang benar-benar dikirim,
 * bukan diketik ulang. Tidak ada private key yang dibaca atau ditulis.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, zeroAddress, type Address } from "viem";

import { CONTRACTS_DIR, REPO_ROOT } from "../lib/env.ts";

/**
 * Metadata jaringan. Sumber Robinhood Chain: https://docs.robinhood.com/chain/connecting/
 * (chain ID juga dikonfirmasi lewat eth_chainId ke RPC publik masing-masing).
 */
const NETWORKS: Record<number, { key: string; name: string; prefix: string; explorer?: string; publicRpc: string }> = {
  46630: {
    key: "testnet",
    name: "Robinhood Chain Testnet",
    prefix: "ROBINHOOD_TESTNET",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    publicRpc: "https://rpc.testnet.chain.robinhood.com",
  },
  4663: {
    key: "mainnet",
    name: "Robinhood Chain",
    prefix: "ROBINHOOD",
    explorer: "https://robinhoodchain.blockscout.com",
    publicRpc: "https://rpc.mainnet.chain.robinhood.com",
  },
  31337: { key: "anvil", name: "Local (Anvil)", prefix: "ROBINHOOD_TESTNET", publicRpc: "http://127.0.0.1:8545" },
};

type BroadcastTx = {
  transactionType: string;
  contractName: string | null;
  contractAddress: Address | null;
  function: string | null;
  arguments: string[] | null;
  hash: string;
};
type Broadcast = {
  transactions: BroadcastTx[];
  receipts: { transactionHash: string; blockNumber: string; status: string }[];
  timestamp: number;
};

function main() {
  const chainId = Number(process.argv[2] ?? 46630);
  const net = NETWORKS[chainId];
  if (!net) throw new Error(`Chain ID ${chainId} tidak dikenal. Pakai 46630 (testnet) atau 4663 (mainnet).`);

  const file = join(CONTRACTS_DIR, "broadcast", "Deploy.s.sol", String(chainId), "run-latest.json");
  if (!existsSync(file)) {
    throw new Error(`${file} tidak ada. Jalankan dulu deploy dengan --broadcast (lihat README bagian 2).`);
  }
  const b = JSON.parse(readFileSync(file, "utf8")) as Broadcast;

  const created = (name: string) =>
    b.transactions.find((t) => t.transactionType === "CREATE" && t.contractName === name);
  const arenaTx = created("DuelArena");
  if (!arenaTx?.contractAddress) throw new Error("DuelArena tidak ditemukan di broadcast.");
  const devTx = created("DevRandomnessProvider");
  const vrfTx = created("ChainlinkVRFAdapter");

  const receipt = b.receipts.find((r) => r.transactionHash === arenaTx.hash);
  if (!receipt) throw new Error("Receipt deploy DuelArena tidak ada; deploy belum terkonfirmasi?");
  if (BigInt(receipt.status) !== 1n) throw new Error("Transaksi deploy DuelArena gagal.");
  const startBlock = Number(BigInt(receipt.blockNumber));

  // USDG = token non-ETH yang diaktifkan lewat setTokenConfig di deploy yang sama.
  const usdgArg = b.transactions
    .filter((t) => t.function?.startsWith("setTokenConfig(") && t.arguments?.[0])
    .map((t) => getAddress(t.arguments![0]!))
    .find((a) => a !== zeroAddress);
  const pendingOwner = b.transactions.find((t) => t.function?.startsWith("transferOwnership("))?.arguments?.[0];

  const deployment = {
    network: net.key,
    chainId,
    startBlock,
    // Forge menulis timestamp dalam milidetik (versi lama: detik).
    deployedAt: new Date(b.timestamp > 1e12 ? b.timestamp : b.timestamp * 1000).toISOString(),
    contracts: {
      arena: getAddress(arenaTx.contractAddress),
      randomness: getAddress((vrfTx ?? devTx)!.contractAddress!),
      randomnessKind: vrfTx ? "ChainlinkVRFAdapter" : "DevRandomnessProvider",
      usdg: usdgArg ?? null,
    },
    pendingOwner: pendingOwner ? getAddress(pendingOwner) : null,
  };
  mkdirSync(join(REPO_ROOT, "deployments"), { recursive: true });
  const out = join(REPO_ROOT, "deployments", `${net.key}.json`);
  writeFileSync(out, JSON.stringify(deployment, null, 2) + "\n");

  const rpcNote = `${net.publicRpc}   # RPC publik dibatasi; ganti dengan RPC berbayar (Alchemy/QuickNode/Chainstack)`;
  const c = deployment.contracts;
  const block = (title: string, lines: string[]) => console.log(`\n# ── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}\n${lines.join("\n")}`);

  console.log(`Deployment ${net.name} (chain ${chainId}) → ${out}`);
  console.log(`DuelArena ${c.arena} · ${c.randomnessKind} ${c.randomness} · blok ${startBlock}`);
  if (c.randomnessKind === "DevRandomnessProvider" && chainId === 4663) {
    console.log("\n!! DevRandomnessProvider di MAINNET melanggar docs/spec.md 3.6 no. 10. Jangan dipakai.");
  }

  block("Railway: service indexer", [
    `INDEXER_CHAIN=${net.key === "anvil" ? "testnet" : net.key}`,
    `${net.prefix}_RPC=${rpcNote}`,
    `${net.prefix}_CHAIN_ID=${chainId}`,
    `ARENA_ADDRESS=${c.arena}`,
    `ARENA_START_BLOCK=${startBlock}`,
    "DATABASE_URL=${{Postgres.DATABASE_URL}}",
    `DATABASE_SCHEMA=rivl_${startBlock}`,
  ]);

  if (c.randomnessKind === "DevRandomnessProvider") {
    block("Railway: service auto-fulfill (HANYA testnet)", [
      "AUTO_FULFILL_CHAIN=testnet",
      `ROBINHOOD_TESTNET_RPC=${rpcNote}`,
      `ROBINHOOD_TESTNET_CHAIN_ID=${chainId}`,
      `DEV_RANDOMNESS_ADDRESS=${c.randomness}`,
      `ARENA_ADDRESS=${c.arena}`,
      `ARENA_START_BLOCK=${startBlock}`,
      "PRIVATE_KEY=<isi sebagai variabel rahasia di Railway: private key deployer = owner DevRandomnessProvider>",
    ]);
  }

  block("Vercel: project web (Root Directory = web)", [
    `NEXT_PUBLIC_CHAIN_ID=${chainId}`,
    `NEXT_PUBLIC_CHAIN_NAME=${net.name}`,
    `NEXT_PUBLIC_RPC_URL=${rpcNote}`,
    `NEXT_PUBLIC_EXPLORER_URL=${net.explorer ?? ""}`,
    `NEXT_PUBLIC_ARENA_ADDRESS=${c.arena}`,
    `NEXT_PUBLIC_USDG_ADDRESS=${c.usdg ?? ""}`,
    "NEXT_PUBLIC_INDEXER_URL=<URL publik service indexer di Railway, mis. https://rivl-indexer.up.railway.app>",
    "NEXT_PUBLIC_X_URL=",
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=",
    "BLOCKED_COUNTRIES=ID,US",
    "GEO_COUNTRY_HEADER=x-vercel-ip-country",
    "ENABLE_EXPERIMENTAL_COREPACK=1",
  ]);

  if (deployment.pendingOwner) {
    console.log(`\nIngat: ${deployment.pendingOwner} harus memanggil acceptOwnership() di ${c.arena} (Ownable2Step).`);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
