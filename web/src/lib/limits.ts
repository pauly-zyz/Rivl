/**
 * Batas pribadi (docs/spec.md 5.2 /me): batas taruhan harian per token dan "Take a break".
 * Disimpan di browser. Fungsi di sini murni supaya bisa diuji.
 *
 * - Batas harian = total taruhan alamat ini dalam 24 jam terakhir (rolling), per token.
 * - Menurunkan atau memasang batas berlaku langsung. Menaikkan atau menghapus berlaku 24 jam kemudian
 *   (praktik umum responsible gaming: keputusan untuk bermain lebih banyak tidak boleh impulsif).
 * - Take a break menyembunyikan Create/Join sampai waktunya habis dan tidak bisa dibatalkan dari aplikasi.
 */
import type { KeyValueStore } from "./suit";

export const LIMITS_KEY = "rivl:limits:v1";
export const DAY = 86_400;
export const COOLDOWN = DAY;
export const BREAK_OPTIONS = [
  { label: "24 hours", seconds: DAY },
  { label: "7 days", seconds: 7 * DAY },
  { label: "30 days", seconds: 30 * DAY },
] as const;

type TokenLimit = {
  /** Batas yang berlaku sekarang (unit terkecil token), null = tanpa batas. */
  amount: string | null;
  /** Perubahan yang lebih longgar, berlaku pada `effectiveAt` (detik unix). */
  pending?: { amount: string | null; effectiveAt: number };
};

export type LimitsState = {
  daily: Record<string, TokenLimit>;
  breakUntil?: number;
};

export const EMPTY_LIMITS: LimitsState = { daily: {} };

export function loadLimits(store: KeyValueStore): LimitsState {
  try {
    const v = JSON.parse(store.getItem(LIMITS_KEY) ?? "null") as LimitsState | null;
    if (!v || typeof v !== "object" || typeof v.daily !== "object") return EMPTY_LIMITS;
    return v;
  } catch {
    return EMPTY_LIMITS;
  }
}

export function saveLimits(store: KeyValueStore, state: LimitsState): void {
  store.setItem(LIMITS_KEY, JSON.stringify(state));
}

const key = (token: string) => token.toLowerCase();

/** Batas yang berlaku pada waktu `now` (perubahan tertunda diterapkan jika sudah waktunya). */
export function effectiveLimit(state: LimitsState, token: string, now: number): bigint | null {
  const entry = state.daily[key(token)];
  if (!entry) return null;
  const amount = entry.pending && entry.pending.effectiveAt <= now ? entry.pending.amount : entry.amount;
  return amount === null ? null : BigInt(amount);
}

export function pendingLimit(state: LimitsState, token: string, now: number) {
  const p = state.daily[key(token)]?.pending;
  return p && p.effectiveAt > now ? { amount: p.amount === null ? null : BigInt(p.amount), effectiveAt: p.effectiveAt } : undefined;
}

/** Pasang batas baru (null = hapus batas). Lebih ketat → langsung; lebih longgar → setelah 24 jam. */
export function setDailyLimit(state: LimitsState, token: string, amount: bigint | null, now: number): LimitsState {
  const current = effectiveLimit(state, token, now);
  const stricter = amount !== null && (current === null || amount <= current);
  const entry: TokenLimit = stricter
    ? { amount: amount.toString() }
    : {
        amount: current === null ? null : current.toString(),
        pending: { amount: amount === null ? null : amount.toString(), effectiveAt: now + COOLDOWN },
      };
  return { ...state, daily: { ...state.daily, [key(token)]: entry } };
}

/** Mulai jeda. Jeda yang sedang berjalan hanya bisa diperpanjang, tidak dipersingkat. */
export function startBreak(state: LimitsState, seconds: number, now: number): LimitsState {
  const until = now + seconds;
  return { ...state, breakUntil: Math.max(until, state.breakUntil ?? 0) };
}

export function onBreak(state: LimitsState, now: number): boolean {
  return (state.breakUntil ?? 0) > now;
}

/** Duel dari indexer, cukup kolom yang dibutuhkan. */
export type StakeRecord = {
  token: string;
  amount: string;
  creator: string;
  joiner: string | null;
  createdAt: string;
  joinedAt: string | null;
  status: string;
};

/**
 * Total taruhan `address` untuk `token` dalam 24 jam terakhir.
 * Taruhan dihitung saat dana dikunci: saat membuat duel (pembuat) atau saat bergabung (penantang).
 * Duel yang dibatalkan tidak dihitung karena dananya kembali tanpa bermain.
 */
export function spentInLastDay(duels: StakeRecord[], address: string, token: string, now: number): bigint {
  const a = address.toLowerCase();
  const t = token.toLowerCase();
  const since = now - DAY;
  let total = 0n;
  for (const d of duels) {
    if (d.token.toLowerCase() !== t || d.status === "Cancelled") continue;
    const asCreator = d.creator.toLowerCase() === a && Number(d.createdAt) > since;
    const asJoiner = d.joiner?.toLowerCase() === a && d.joinedAt !== null && Number(d.joinedAt) > since;
    if (asCreator || asJoiner) total += BigInt(d.amount);
  }
  return total;
}
