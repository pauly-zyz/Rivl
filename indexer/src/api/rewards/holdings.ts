/**
 * Saldo holder RIVL dari event Transfer, dicatat sendiri oleh API (bukan tabel Ponder, supaya tidak perlu index ulang).
 * Syarat spin: saldo tidak pernah di bawah batas selama minHoldHours terakhir (anti pindah-pindah token antar wallet).
 */
import { getAddress, zeroAddress, type Address } from "viem";

import { client, erc20, transferEvent } from "./chain";
import { rewardsEnv } from "./env";
import { store } from "./store";

const CHUNK = 5_000n;

async function syncOnce(): Promise<boolean> {
  const token = rewardsEnv.rivl;
  if (!token) return false;
  const db = await store();
  const [cur] = await db.query<{ token: string; last_block: string }>("select token, last_block from rivl_rewards.cursor where id = 1");
  let from = cur && cur.token === token.toLowerCase() ? BigInt(cur.last_block) + 1n : rewardsEnv.rivlStartBlock;
  if (cur && cur.token !== token.toLowerCase()) {
    // Alamat token berubah (mis. chain lokal baru): mulai dari awal.
    await db.query("delete from rivl_rewards.balance");
    await db.query("delete from rivl_rewards.balance_change");
  }
  const headBlock = await client.getBlock({ blockTag: "latest" });
  const head = headBlock.number;
  if (from > head) {
    await saveCursor(token, head, Number(headBlock.timestamp));
    return false;
  }
  const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
  const logs = await client.getLogs({ address: token, event: transferEvent, fromBlock: from, toBlock: to });
  const times = new Map<bigint, number>();
  for (const log of logs) {
    if (log.blockNumber === null || times.has(log.blockNumber)) continue;
    const b = await client.getBlock({ blockNumber: log.blockNumber });
    times.set(log.blockNumber, Number(b.timestamp));
  }
  const balances = new Map<string, bigint>();
  const get = async (a: string) => {
    if (!balances.has(a)) {
      const [r] = await db.query<{ balance: string }>("select balance from rivl_rewards.balance where account = $1", [a]);
      balances.set(a, r ? BigInt(r.balance) : 0n);
    }
    return balances.get(a)!;
  };
  for (const log of logs) {
    const { from: f, to: t, value } = log.args as { from: Address; to: Address; value: bigint };
    const ts = times.get(log.blockNumber!)!;
    for (const [account, delta] of [
      [f.toLowerCase(), -value],
      [t.toLowerCase(), value],
    ] as const) {
      if (account === zeroAddress) continue;
      const next = (await get(account)) + delta;
      balances.set(account, next);
      await db.query(
        `insert into rivl_rewards.balance_change (block, log_index, account, ts, balance_after) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [log.blockNumber!.toString(), log.logIndex!, account, ts, next.toString()],
      );
    }
  }
  for (const [account, balance] of balances) {
    await db.query(
      `insert into rivl_rewards.balance (account, balance) values ($1, $2)
       on conflict (account) do update set balance = excluded.balance`,
      [account, balance.toString()],
    );
  }
  const toTs = to === head ? Number(headBlock.timestamp) : Number((await client.getBlock({ blockNumber: to })).timestamp);
  await saveCursor(token, to, toTs);
  return to < head;
}

async function saveCursor(token: Address, block: bigint, ts: number) {
  const db = await store();
  await db.query(
    `insert into rivl_rewards.cursor (id, token, last_block, last_ts) values (1, $1, $2, $3)
     on conflict (id) do update set token = excluded.token, last_block = excluded.last_block, last_ts = excluded.last_ts`,
    [token.toLowerCase(), block.toString(), ts],
  );
}

/** Mulai pencatatan di latar (sekali per proses). */
export function startHoldingsSync() {
  const g = globalThis as { __rivlHoldings?: boolean };
  if (g.__rivlHoldings || !rewardsEnv.rivl) return;
  g.__rivlHoldings = true;
  const idle = rewardsEnv.mode === "local" ? 1_000 : 4_000;
  const loop = async () => {
    let behind = false;
    try {
      behind = await syncOnce();
    } catch (err) {
      console.warn("[rewards] RIVL holdings sync failed:", err instanceof Error ? err.message : err);
    }
    setTimeout(loop, behind ? 50 : idle);
  };
  void loop();
}

/** Status sinkronisasi: blok & waktu blok terakhir yang sudah dicatat. */
export async function holdingsCursor(): Promise<{ block: bigint; ts: number } | undefined> {
  const db = await store();
  const [cur] = await db.query<{ token: string; last_block: string; last_ts: string }>(
    "select token, last_block, last_ts from rivl_rewards.cursor where id = 1",
  );
  if (!cur || cur.token !== rewardsEnv.rivl?.toLowerCase()) return undefined;
  return { block: BigInt(cur.last_block), ts: Number(cur.last_ts) };
}

export type Eligibility = {
  balance: bigint;
  required: bigint;
  /** Sejak kapan saldo terus ≥ batas (null = sedang di bawah batas). */
  holdSince: number | null;
  /** Kapan boleh spin (holdSince + jam hold). */
  eligibleAt: number | null;
  eligible: boolean;
};

export async function eligibility(account: Address, required: bigint, holdSeconds: number, now: number): Promise<Eligibility> {
  const db = await store();
  const a = account.toLowerCase();
  const rows = await db.query<{ ts: string; balance_after: string }>(
    "select ts, balance_after from rivl_rewards.balance_change where account = $1 order by block asc, log_index asc",
    [a],
  );
  const [bal] = await db.query<{ balance: string }>("select balance from rivl_rewards.balance where account = $1", [a]);
  const balance = bal ? BigInt(bal.balance) : 0n;
  let holdSince: number | null = null;
  for (const r of rows) {
    if (BigInt(r.balance_after) >= required) holdSince ??= Number(r.ts);
    else holdSince = null;
  }
  if (balance < required) holdSince = null;
  const eligibleAt = holdSince === null ? null : holdSince + holdSeconds;
  return { balance, required, holdSince, eligibleAt, eligible: eligibleAt !== null && eligibleAt <= now };
}

/** Saldo langsung dari chain (pengaman jika pencatatan sedikit tertinggal). */
export async function liveBalance(account: Address): Promise<bigint> {
  if (!rewardsEnv.rivl) return 0n;
  return client.readContract({ address: rewardsEnv.rivl, abi: erc20, functionName: "balanceOf", args: [getAddress(account)] });
}
