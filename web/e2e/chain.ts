import { createTestClient, createWalletClient, defineChain, http, parseEther, zeroAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { duelArenaAbi } from "@rivl/contracts/abi";

import { computeCommit, randomSalt } from "../src/lib/suit";
import { chainClient, deployment, getDuel } from "./wallet";

/** Mainkan duel langsung lewat RPC (akun Anvil unlocked) untuk menyiapkan data test /fair. */
const d = deployment();
const chain = defineChain({
  id: d.chainId,
  name: "Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [d.rpcUrl] } },
});
const wallet = createWalletClient({ chain, transport: http(d.rpcUrl) });
const client = chainClient(d);

async function send(account: Address, functionName: string, args: readonly unknown[], value?: bigint) {
  const hash = await wallet.writeContract({ address: d.contracts.arena, abi: duelArenaAbi, functionName, args, value, account } as never);
  await client.waitForTransactionReceipt({ hash });
}

async function nextId() {
  return client.readContract({ address: d.contracts.arena, abi: duelArenaAbi, functionName: "nextDuelId" });
}

async function waitFinished(id: bigint) {
  for (let i = 0; i < 100; i++) {
    const s = (await getDuel(id)).status;
    if (s === 4 || s === 5) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`duel ${id} belum selesai (auto-fulfill jalan?)`);
}

const stake = parseEther("0.001");

export async function playRandomDuel(game: "Coinflip" | "Dice", creator: Address, joiner: Address): Promise<bigint> {
  const id = await nextId();
  if (game === "Coinflip") await send(creator, "createCoinflip", [zeroAddress, stake, 1], stake);
  else await send(creator, "createDice", [zeroAddress, stake], stake);
  await send(joiner, "join", [id, 0], stake);
  await waitFinished(id);
  return id;
}

export async function playSuit(creator: Address, joiner: Address, move: number, joinerMove: number): Promise<bigint> {
  const salt = randomSalt();
  const commit = computeCommit({ chainId: d.chainId, arena: d.contracts.arena, creator, move, salt });
  const id = await nextId();
  await send(creator, "createSuit", [zeroAddress, stake, commit], stake);
  await send(joiner, "join", [id, joinerMove], stake);
  await send(creator, "revealSuit", [id, move, salt]);
  return id;
}

/**
 * Alamat baru tanpa riwayat (untuk test yang bergantung pada taruhan 24 jam terakhir).
 * Anvil meng-impersonate alamat ini supaya dompet uji bisa mengirim transaksi tanpa private key.
 */
export async function freshAccount(): Promise<Address> {
  const address = privateKeyToAccount(generatePrivateKey()).address;
  const test = createTestClient({ chain, mode: "anvil", transport: http(d.rpcUrl) });
  await test.impersonateAccount({ address });
  await test.setBalance({ address, value: parseEther("10") });
  return address;
}

/** Majukan waktu Anvil (mis. melewati jendela reveal) dan tambang satu blok. */
export async function warp(seconds: number) {
  const test = createTestClient({ chain, mode: "anvil", transport: http(d.rpcUrl) });
  await test.increaseTime({ seconds });
  await test.mine({ blocks: 1 });
}

export async function arenaRead<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  return client.readContract({ address: d.contracts.arena, abi: duelArenaAbi, functionName, args } as never) as Promise<T>;
}

export async function balanceOf(account: Address, token: Address | "ETH"): Promise<bigint> {
  if (token === "ETH") return client.getBalance({ address: account });
  return client.readContract({
    address: token,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [account],
  });
}
