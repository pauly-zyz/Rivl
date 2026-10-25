"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";

import { appConfig } from "./config";

/*
 * Daily Spin untuk holder RIVL. Semua data dari indexer (/rewards/*, indexer/src/api/rewards/routes.ts).
 * Spin dan equip hanya butuh tanda tangan wallet (gratis); klaim hadiah token = 1 transaksi ke RivlRewards.
 */

export const PRIZE_ORDER = [
  "try_again",
  "fee_free_1",
  "fee_free_3",
  "xp_50",
  "xp_150",
  "cosmetic",
  "rivl_10k",
  "rivl_50k",
  "jackpot",
] as const;
export type Prize = (typeof PRIZE_ORDER)[number];

export const PRIZE_LABEL: Record<Prize, string> = {
  try_again: "Try again",
  fee_free_1: "1 fee-free win",
  fee_free_3: "3 fee-free wins",
  xp_50: "+50 XP",
  xp_150: "+150 XP",
  cosmetic: "Cosmetic",
  rivl_10k: "10,000 RIVL",
  rivl_50k: "50,000 RIVL",
  jackpot: "JACKPOT 1,000,000 RIVL",
};

export type CosmeticKind = "frame" | "badge" | "title";
export type Rarity = "common" | "rare" | "epic" | "legendary";
export type CosmeticInfo = { id: string; kind: CosmeticKind; name: string; rarity: Rarity; spin: boolean };

export type Settings = {
  enabled: boolean;
  launchAt: number | null;
  jackpotDelayDays: number;
  jackpotPpm: number;
  jackpotWeeklyMax: number;
  minHoldTokens: string;
  minHoldHours: number;
  weeklyRivlBudget: string;
  pityAfter: number;
  odds: Record<Exclude<Prize, "jackpot">, number>;
};

export type Blocker = "token" | "secret" | "off" | "not_started" | null;

export type RewardsInfo = {
  blocker: Blocker;
  now: number;
  day: string;
  week: string;
  nextResetAt: number;
  token: { address: Address; decimals: number; symbol: string } | null;
  rewards: Address | null;
  settings: Settings;
  odds: Record<Prize, number>;
  prizes: { rivl: Record<string, string>; xp: Record<string, number> };
  weekly: { rivlAwarded: string; jackpots: number };
  holdingsSyncedAt: number | null;
  fairness: { day: string; commit: Hex | null; commitTomorrow: Hex | null };
  cosmetics: CosmeticInfo[];
};

export type SpinResult = {
  day: string;
  roll: number;
  rolled: Prize;
  prize: Prize;
  xp: number;
  amount: string | null;
  cosmetic: string | null;
  vouchers: number;
  pity: boolean;
  odds: Record<Prize, number>;
  createdAt: number;
};

export type Equipped = { frame: string | null; badge: string | null; title: string | null };

export type PlayerRewards = {
  address: Address;
  now: number;
  blocker: Blocker;
  eligibility: { balance: string; required: string; holdSince: number | null; eligibleAt: number | null; eligible: boolean } | null;
  today: SpinResult | null;
  nextResetAt: number;
  history: SpinResult[];
  xp: number;
  level: number;
  levelXp: number;
  vouchers: { earned: number; used: number; remaining: number };
  rebates: { duelId: string; token: Address; fee: string; usedAt: number }[];
  inventory: { id: string; acquiredAt: number }[];
  equipped: Equipped;
  earned: { token: Address; amount: string }[];
};

export type ProofResponse = {
  rewards: Address | null;
  root: Hex | null;
  epoch: number | null;
  claims: { token: Address; cumulativeAmount: string; proof: Hex[] }[];
};

const base = () => `${appConfig().indexerUrl}/rewards`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`);
  if (!res.ok) throw new Error(`Rewards API error ${res.status}`);
  return (await res.json()) as T;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function useRewardsInfo() {
  return useQuery({ queryKey: ["rewards", "info"], queryFn: () => get<RewardsInfo>("/info"), refetchInterval: 30_000, retry: 1 });
}

export function usePlayerRewards(address: Address | undefined) {
  return useQuery({
    queryKey: ["rewards", "player", address?.toLowerCase()],
    enabled: !!address,
    queryFn: () => get<PlayerRewards>(`/player/${address}`),
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useRewardsProof(address: Address | undefined) {
  return useQuery({
    queryKey: ["rewards", "proof", address?.toLowerCase()],
    enabled: !!address,
    queryFn: () => get<ProofResponse>(`/proof/${address}`),
    refetchInterval: 60_000,
    retry: 1,
  });
}

export const fairnessOf = (day: string) => get<{ day: string; commit: Hex; seed: Hex | null }>(`/fairness/${day}`);

// --- Pesan yang ditandatangani (harus sama persis dengan indexer) ----------------------------------

export const spinMessage = (wallet: Address, day: string) =>
  `Rivl Daily Spin\n\nWallet: ${wallet}\nDay: ${day} (UTC)\n\nSigning is free and does not send a transaction.`;

export const equipMessage = (wallet: Address, e: Equipped, issuedAt: number) =>
  `Rivl: equip cosmetics\n\nWallet: ${wallet}\nFrame: ${e.frame ?? "none"}\nBadge: ${e.badge ?? "none"}\nTitle: ${e.title ?? "none"}\nIssued: ${issuedAt}`;

export const adminMessage = (action: string, issuedAt: number, data: unknown) =>
  `Rivl rewards admin\n\nAction: ${action}\nIssued: ${issuedAt}\n\n${JSON.stringify(data)}`;

// --- Kosmetik yang dipakai (dibatch: banyak avatar di satu halaman = satu request) ----------------

const NONE: Equipped = { frame: null, badge: null, title: null };
let pending: { addresses: Set<string>; waiters: ((m: Record<string, Equipped>) => void)[] } | undefined;

function loadEquipped(address: string): Promise<Equipped> {
  const a = address.toLowerCase();
  if (!pending) {
    const batch = (pending = { addresses: new Set<string>(), waiters: [] as ((m: Record<string, Equipped>) => void)[] });
    setTimeout(async () => {
      pending = undefined;
      let items: Record<string, Equipped> = {};
      try {
        items = (await get<{ items: Record<string, Equipped> }>(`/cosmetics?addresses=${[...batch.addresses].slice(0, 100).join(",")}`)).items;
      } catch {
        /* kosmetik bersifat hiasan: gagal = tampil polos */
      }
      batch.waiters.forEach((w) => w(items));
    }, 30);
  }
  pending.addresses.add(a);
  return new Promise((resolve) => pending!.waiters.push((m) => resolve(m[a] ?? NONE)));
}

/** Kosmetik yang sedang dipakai sebuah alamat (frame avatar, badge, title). */
export function useEquipped(address: string | null | undefined): Equipped {
  const { data } = useQuery({
    queryKey: ["rewards", "equipped", address?.toLowerCase()],
    enabled: !!address && /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address),
    queryFn: () => loadEquipped(address!),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? NONE;
}
