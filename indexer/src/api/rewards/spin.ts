/** Satu spin harian: acak dari seed harian, lalu batas jackpot/anggaran/kosmetik diterapkan. */
import type { Address } from "viem";

import { pickCosmetic } from "./cosmetics";
import { rivlMeta } from "./chain";
import { rewardsEnv } from "./env";
import { dayOf, randomOf, ROLL_SPACE, seedOf, weekOf } from "./fairness";
import { effectiveOdds, PRIZES, type Prize, type Settings } from "./settings";
import { serial, store } from "./store";

/** Jumlah RIVL (token utuh) per hadiah token. */
export const RIVL_PRIZES: Partial<Record<Prize, bigint>> = { rivl_10k: 10_000n, rivl_50k: 50_000n, jackpot: 1_000_000n };
export const XP_PRIZES: Partial<Record<Prize, number>> = { xp_50: 50, xp_150: 150 };
export const VOUCHER_PRIZES: Partial<Record<Prize, number>> = { fee_free_1: 1, fee_free_3: 3 };

export type SpinRow = {
  account: string;
  day: string;
  week: string;
  created_at: string;
  roll: number;
  rolled: Prize;
  prize: Prize;
  xp: number;
  token: string | null;
  amount: string | null;
  cosmetic: string | null;
  vouchers: number;
  pity: boolean;
  odds: string;
};

/** Hadiah dari angka roll (0..999.999) dan tabel peluang, mengikuti urutan PRIZES. */
export function prizeOf(roll: number, odds: Record<Prize, number>, pity: boolean): Prize {
  let x = roll;
  if (pity) {
    // Jaminan hadiah: roll dipetakan ke bagian selain "coba lagi".
    const rest = 1_000_000 - odds.try_again;
    x = odds.try_again + (rest > 0 ? roll % rest : 0);
  }
  for (const p of PRIZES) {
    x -= odds[p];
    if (x < 0) return p;
  }
  return "xp_50";
}

export async function getSpin(account: Address, day: string): Promise<SpinRow | undefined> {
  const db = await store();
  const [row] = await db.query<SpinRow>("select * from rivl_rewards.spin where account = $1 and day = $2", [account.toLowerCase(), day]);
  return row;
}

/** `chainNow` = waktu blok terbaru: voucher hanya berlaku untuk duel yang selesai setelah waktu chain ini. */
export async function performSpin(account: Address, settings: Settings, now: number, chainNow = now): Promise<SpinRow> {
  return serial(async () => {
    const db = await store();
    const a = account.toLowerCase();
    const day = dayOf(now);
    const existing = await getSpin(account, day);
    if (existing) return existing;

    const week = weekOf(now);
    const seed = seedOf(day);
    const odds = effectiveOdds(settings, now);
    const roll = Number(randomOf(seed, account, day) % ROLL_SPACE);

    const recent = await db.query<{ prize: Prize }>(
      "select prize from rivl_rewards.spin where account = $1 order by day desc limit $2",
      [a, Math.max(settings.pityAfter, 1)],
    );
    const pity = settings.pityAfter > 0 && recent.length >= settings.pityAfter && recent.every((r) => r.prize === "try_again");
    const rolled = prizeOf(roll, odds, pity);
    let prize: Prize = rolled;

    // Batas jackpot per minggu.
    if (prize === "jackpot") {
      const [{ n }] = (await db.query<{ n: string }>(
        "select count(*) as n from rivl_rewards.spin where week = $1 and prize = 'jackpot'",
        [week],
      )) as [{ n: string }];
      if (Number(n) >= settings.jackpotWeeklyMax) prize = "rivl_50k";
    }
    // Anggaran RIVL per minggu.
    const { decimals } = await rivlMeta();
    const unit = 10n ** BigInt(decimals);
    if (RIVL_PRIZES[prize] !== undefined) {
      const [{ total }] = (await db.query<{ total: string | null }>(
        "select coalesce(sum(amount), 0)::text as total from rivl_rewards.spin where week = $1 and amount is not null",
        [week],
      )) as [{ total: string | null }];
      const used = BigInt(total ?? "0");
      if (used + RIVL_PRIZES[prize]! * unit > BigInt(settings.weeklyRivlBudget) * unit) prize = "xp_150";
    }
    // Kosmetik yang belum dimiliki.
    let cosmetic: string | null = null;
    if (prize === "cosmetic") {
      const owned = await db.query<{ cosmetic: string }>("select cosmetic from rivl_rewards.inventory where account = $1", [a]);
      const pick = pickCosmetic(new Set(owned.map((o) => o.cosmetic)), randomOf(seed, account, day, "cosmetic"));
      if (pick) cosmetic = pick.id;
      else prize = "xp_150";
    }

    const amount = RIVL_PRIZES[prize] !== undefined ? (RIVL_PRIZES[prize]! * unit).toString() : null;
    const row: SpinRow = {
      account: a,
      day,
      week,
      created_at: String(Math.max(now, chainNow)),
      roll,
      rolled,
      prize,
      xp: XP_PRIZES[prize] ?? 0,
      token: amount ? rewardsEnv.rivl!.toLowerCase() : null,
      amount,
      cosmetic,
      vouchers: VOUCHER_PRIZES[prize] ?? 0,
      pity,
      odds: JSON.stringify(odds),
    };
    await db.query(
      `insert into rivl_rewards.spin (account, day, week, created_at, roll, rolled, prize, xp, token, amount, cosmetic, vouchers, pity, odds)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [a, day, week, Math.max(now, chainNow), roll, rolled, prize, row.xp, row.token, amount, cosmetic, row.vouchers, pity, row.odds],
    );
    const grant = prize === "jackpot" ? "badge-jackpot" : cosmetic;
    if (grant) {
      await db.query(
        "insert into rivl_rewards.inventory (account, cosmetic, acquired_at) values ($1, $2, $3) on conflict do nothing",
        [a, grant, Math.max(now, chainNow)],
      );
    }
    return row;
  });
}
