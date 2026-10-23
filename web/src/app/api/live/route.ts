/**
 * Duel terbaru langsung dari contract, tanpa menunggu indexer.
 *
 * Indexer bisa tertinggal dari chain (Robinhood Chain ±10 blok/detik). Endpoint ini membaca `nextDuelId` dan
 * `getDuel` untuk LIVE_WINDOW duel terakhir dalam satu panggilan Multicall3, lalu di-cache 1 detik di CDN
 * Vercel. Dengan begitu duel baru, join, cancel, dan hasil tampil dalam ±1–2 detik untuk semua pemain, sementara
 * beban ke RPC tetap ±1 permintaan per detik berapa pun jumlah pemainnya.
 */
import { duelArenaAbi } from "@rivl/contracts/abi";
import { createPublicClient, defineChain, http, isAddress, parseAbi, type Address } from "viem";

const LIVE_WINDOW = 60n;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const multicallAbi = parseAbi(["function getCurrentBlockTimestamp() view returns (uint256)"]);

function client() {
  const rpc = (process.env.RPC_UPSTREAM_URL || process.env.NEXT_PUBLIC_RPC_URL || "").trim();
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID);
  const arena = process.env.NEXT_PUBLIC_ARENA_ADDRESS?.trim() ?? "";
  if (!rpc || !Number.isSafeInteger(chainId) || !isAddress(arena)) return undefined;
  const chain = defineChain({
    id: chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    contracts: { multicall3: { address: MULTICALL3 } },
  });
  return { arena: arena as Address, pc: createPublicClient({ chain, transport: http(rpc, { batch: true, timeout: 10_000 }) }) };
}

type Duel = Awaited<ReturnType<typeof readDuels>>["duels"][number];

async function readDuels(c: NonNullable<ReturnType<typeof client>>) {
  const next = await c.pc.readContract({ address: c.arena, abi: duelArenaAbi, functionName: "nextDuelId" });
  const from = next > LIVE_WINDOW ? next - LIVE_WINDOW : 1n;
  const ids: bigint[] = [];
  for (let id = next - 1n; id >= from; id--) ids.push(id);

  const calls = ids.map((id) => ({ address: c.arena, abi: duelArenaAbi, functionName: "getDuel", args: [id] }) as const);
  let duels;
  let now: bigint;
  try {
    // Satu eth_call untuk semua duel + timestamp blok.
    const res = (await c.pc.multicall({
      allowFailure: false,
      contracts: [{ address: MULTICALL3, abi: multicallAbi, functionName: "getCurrentBlockTimestamp" }, ...calls] as never,
    })) as unknown[];
    now = res[0] as bigint;
    duels = res.slice(1) as Awaited<ReturnType<typeof readOne>>[];
  } catch {
    // Chain tanpa Multicall3 (mis. Anvil lokal): satu batch JSON-RPC berisi panggilan terpisah.
    [duels, now] = await Promise.all([
      Promise.all(ids.map((id) => readOne(c, id))),
      c.pc.getBlock().then((b) => b.timestamp),
    ]);
  }
  return { next, now, duels: duels.map((d, i) => ({ id: ids[i]!, ...d })) };
}

function readOne(c: NonNullable<ReturnType<typeof client>>, id: bigint) {
  return c.pc.readContract({ address: c.arena, abi: duelArenaAbi, functionName: "getDuel", args: [id] });
}

const toJson = (d: Duel) =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

export async function GET() {
  const c = client();
  if (!c) return Response.json({ error: "Live reader is not configured" }, { status: 500 });
  try {
    const { next, now, duels } = await readDuels(c);
    return Response.json(
      { nextId: next.toString(), now: now.toString(), duels: duels.map(toJson) },
      // CDN Vercel menyimpan 1 detik; permintaan lain dalam detik itu tidak menyentuh RPC.
      { headers: { "cache-control": "public, max-age=0, s-maxage=1, stale-while-revalidate=2" } },
    );
  } catch {
    return Response.json({ error: "Chain read failed" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
