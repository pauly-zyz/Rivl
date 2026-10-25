/**
 * "Duel tanpa fee" = pengembalian fee: setiap voucher dipakai otomatis untuk duel berikutnya yang DIMENANGKAN
 * pemain (status Settled, setelah voucher didapat). Fee duel itu masuk ke klaim mingguan dalam token duelnya.
 */
import { db } from "ponder:api";
import schema from "ponder:schema";
import { and, asc, eq, gt, notInArray } from "ponder";

import { serial, store } from "./store";

const { duel } = schema;

type Voucher = { at: number };

async function vouchersOf(account: string): Promise<Voucher[]> {
  const s = await store();
  const rows = await s.query<{ created_at: string; vouchers: number }>(
    "select created_at, vouchers from rivl_rewards.spin where account = $1 and vouchers > 0 order by created_at asc",
    [account],
  );
  return rows.flatMap((r) => Array.from({ length: r.vouchers }, () => ({ at: Number(r.created_at) })));
}

/** Pakai voucher yang tersisa untuk duel menang yang belum mendapat pengembalian. */
export async function applyVouchers(account: string): Promise<{ earned: number; used: number }> {
  return serial(async () => {
    const s = await store();
    const vouchers = await vouchersOf(account);
    const used = await s.query<{ duel_id: string; used_at: string }>(
      "select duel_id, used_at from rivl_rewards.voucher_use where account = $1",
      [account],
    );
    let remaining = vouchers.slice(used.length);
    if (remaining.length === 0) return { earned: vouchers.length, used: used.length };

    const candidates = await db
      .select({ id: duel.id, token: duel.token, fee: duel.fee, settledAt: duel.settledAt })
      .from(duel)
      .where(
        and(
          eq(duel.status, "Settled"),
          eq(duel.winner, account as `0x${string}`),
          gt(duel.settledAt, BigInt(remaining[0]!.at)),
          used.length ? notInArray(duel.id, used.map((u) => BigInt(u.duel_id))) : undefined,
        ),
      )
      .orderBy(asc(duel.settledAt), asc(duel.id))
      .limit(remaining.length);

    let count = used.length;
    for (const d of candidates) {
      const v = remaining[0];
      if (!v || d.settledAt === null || Number(d.settledAt) <= v.at || !d.fee) continue;
      await s.query(
        "insert into rivl_rewards.voucher_use (duel_id, account, token, fee, used_at) values ($1, $2, $3, $4, $5) on conflict do nothing",
        [d.id.toString(), account, d.token.toLowerCase(), d.fee.toString(), Number(d.settledAt)],
      );
      remaining = remaining.slice(1);
      count++;
    }
    return { earned: vouchers.length, used: count };
  });
}

/** Semua akun yang masih punya voucher (dipakai sebelum menyusun klaim mingguan). */
export async function applyAllVouchers(): Promise<void> {
  const s = await store();
  const rows = await s.query<{ account: string }>(
    `select account from rivl_rewards.spin where vouchers > 0 group by account
     having sum(vouchers) > (select count(*) from rivl_rewards.voucher_use u where u.account = rivl_rewards.spin.account)`,
  );
  for (const r of rows) await applyVouchers(r.account);
}
