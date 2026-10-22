/**
 * scripts/auto-fulfill — memenuhi request DevRandomnessProvider secara otomatis.
 *
 * HANYA untuk chain lokal dan testnet. DevRandomnessProvider membuat owner bisa memilih hasil,
 * jadi tidak boleh dipakai di mainnet (docs/spec.md bagian 3.6 no. 10).
 *
 * - Saat start: cari request lama yang belum dipenuhi (arena.requestToDuel(id) != 0) dan penuhi.
 * - Lalu pantau event RandomnessRequested dan penuhi setiap request baru
 *   dengan 32 byte acak dari crypto.getRandomValues, setelah jeda AUTO_FULFILL_DELAY_MS.
 *
 * Mode lokal (default): semua alamat dari deployments/local.json, transaksi dari akun Anvil unlocked.
 * Mode testnet: AUTO_FULFILL_CHAIN=testnet + ROBINHOOD_TESTNET_RPC, ROBINHOOD_TESTNET_CHAIN_ID,
 *               DEV_RANDOMNESS_ADDRESS, ARENA_ADDRESS, ARENA_START_BLOCK, PRIVATE_KEY (owner provider).
 */
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { devRandomnessProviderAbi, duelArenaAbi } from "@rivl/contracts/abi";

import { envInt, envString, loadRootEnv, requireEnv } from "../lib/env.ts";
import { readLocalDeployment } from "../lib/deployments.ts";
import { logger } from "../lib/log.ts";

const log = logger("fulfill");
const LOG_CHUNK = 5_000n;

type Config = {
  chain: Chain;
  rpcUrl: string;
  provider: Address;
  arena: Address;
  fromBlock: bigint;
  account: Account | Address;
  delayMs: number;
};

function resolveConfig(): Config {
  loadRootEnv();
  const delayMs = envInt("AUTO_FULFILL_DELAY_MS", 1500);
  const mode = envString("AUTO_FULFILL_CHAIN") ?? "local";

  if (mode === "local") {
    const d = readLocalDeployment();
    return {
      chain: defineChain({
        id: d.chainId,
        name: "Local",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [d.rpcUrl] } },
      }),
      rpcUrl: d.rpcUrl,
      provider: d.contracts.devRandomness,
      arena: d.contracts.arena,
      fromBlock: BigInt(d.startBlock),
      account: d.owner, // akun Anvil unlocked
      delayMs,
    };
  }

  if (mode === "testnet") {
    const hint = "Ambil dari dokumentasi resmi Robinhood Chain / hasil deploy.";
    const rpcUrl = requireEnv("ROBINHOOD_TESTNET_RPC", hint);
    const id = Number(requireEnv("ROBINHOOD_TESTNET_CHAIN_ID", hint));
    return {
      chain: defineChain({
        id,
        name: "Robinhood Chain Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      }),
      rpcUrl,
      provider: getAddress(requireEnv("DEV_RANDOMNESS_ADDRESS", hint)),
      arena: getAddress(requireEnv("ARENA_ADDRESS", hint)),
      fromBlock: BigInt(requireEnv("ARENA_START_BLOCK", hint)),
      account: privateKeyToAccount(requireEnv("PRIVATE_KEY", "Private key owner DevRandomnessProvider.") as Hex),
      delayMs,
    };
  }

  throw new Error(`AUTO_FULFILL_CHAIN="${mode}" tidak didukung. Hanya "local" atau "testnet" (jangan pernah mainnet).`);
}

export type AutoFulfill = { stop: () => void };

export async function startAutoFulfill(): Promise<AutoFulfill> {
  const cfg = resolveConfig();
  const transport = http(cfg.rpcUrl);
  const publicClient = createPublicClient({ chain: cfg.chain, transport, pollingInterval: 500 });
  const wallet = createWalletClient({ chain: cfg.chain, transport, account: cfg.account });
  const sender = typeof cfg.account === "string" ? cfg.account : cfg.account.address;

  // Pastikan konfigurasi benar sebelum mulai.
  const [owner, consumer] = await Promise.all([
    publicClient.readContract({ address: cfg.provider, abi: devRandomnessProviderAbi, functionName: "owner" }),
    publicClient.readContract({ address: cfg.provider, abi: devRandomnessProviderAbi, functionName: "consumer" }),
  ]);
  if (getAddress(owner) !== getAddress(sender)) {
    throw new Error(`Akun ${sender} bukan owner DevRandomnessProvider (${owner}).`);
  }
  if (getAddress(consumer) !== getAddress(cfg.arena)) {
    throw new Error(`Consumer DevRandomnessProvider (${consumer}) bukan arena ${cfg.arena}.`);
  }

  const seen = new Set<bigint>();
  let queue: Promise<void> = Promise.resolve();

  /** Duel yang masih menunggu request ini, atau 0 jika sudah dipenuhi/di-refund. */
  function pendingDuel(requestId: bigint): Promise<bigint> {
    return publicClient.readContract({
      address: cfg.arena,
      abi: duelArenaAbi,
      functionName: "requestToDuel",
      args: [requestId],
    });
  }

  async function fulfill(requestId: bigint): Promise<void> {
    if (cfg.delayMs > 0) await new Promise((r) => setTimeout(r, cfg.delayMs));
    const duelId = await pendingDuel(requestId);
    if (duelId === 0n) return; // sudah dipenuhi atau di-refund

    const randomWord = BigInt(bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
    const hash = await wallet.writeContract({
      address: cfg.provider,
      abi: devRandomnessProviderAbi,
      functionName: "fulfill",
      args: [requestId, randomWord],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`tx ${hash} revert`);
    log.info(`request #${requestId} → duel #${duelId} dipenuhi (tx ${hash.slice(0, 10)}…)`);
  }

  function enqueue(requestId: bigint): void {
    if (seen.has(requestId)) return;
    seen.add(requestId);
    queue = queue
      .then(() => fulfill(requestId))
      .catch((err: unknown) => {
        seen.delete(requestId); // coba lagi jika event muncul ulang
        log.error(`request #${requestId} gagal: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  // 1. Request lama yang belum dipenuhi.
  const latest = await publicClient.getBlockNumber();
  let backlog = 0;
  for (let from = cfg.fromBlock; from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
    const logs = await publicClient.getContractEvents({
      address: cfg.provider,
      abi: devRandomnessProviderAbi,
      eventName: "RandomnessRequested",
      fromBlock: from,
      toBlock: to,
    });
    for (const l of logs) {
      const id = l.args.requestId;
      if (id !== undefined && (await pendingDuel(id)) !== 0n) {
        backlog++;
        enqueue(id);
      }
    }
  }

  // 2. Request baru.
  const unwatch = publicClient.watchContractEvent({
    address: cfg.provider,
    abi: devRandomnessProviderAbi,
    eventName: "RandomnessRequested",
    fromBlock: latest + 1n,
    onLogs: (logs) => {
      for (const l of logs) if (l.args.requestId !== undefined) enqueue(l.args.requestId);
    },
    onError: (err) => log.error(`watch error: ${err.message}`),
  });

  log.info(
    `memantau ${cfg.provider} di chain ${cfg.chain.id} (jeda ${cfg.delayMs} ms` +
      `${backlog ? `, ${backlog} request lama diproses` : ""})`,
  );
  return { stop: unwatch };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startAutoFulfill().catch((err: unknown) => {
    log.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
