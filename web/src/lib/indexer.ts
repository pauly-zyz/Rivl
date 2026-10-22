"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";

import { appConfig } from "./config";
import type { Game, Status } from "./duel";

/** Baris tabel `duel` dari indexer (indexer/ponder.schema.ts). Bilangan uint dikirim sebagai string. */
export type IndexerDuel = {
  id: string;
  game: Game;
  token: Address;
  amount: string;
  creator: Address;
  creatorChoice: number | null;
  commit: Hex | null;
  createdAt: string;
  expiresAt: string;
  createdTx: Hex;
  joiner: Address | null;
  joinerChoice: number | null;
  joinedAt: string | null;
  deadline: string | null;
  joinedTx: Hex | null;
  requestId: string | null;
  revealedMove: number | null;
  revealTx: Hex | null;
  status: Status;
  winner: Address | null;
  payout: string | null;
  fee: string | null;
  randomWord: string | null;
  settledAt: string | null;
  settledTx: Hex | null;
  coinResult: number | null;
  creatorRoll: number | null;
  joinerRoll: number | null;
  revealTimedOut: boolean;
};

export type PlayerStats = {
  address: Address;
  wins: number;
  losses: number;
  draws: number;
  refunded: number;
  cancelled: number;
  active: number;
  byToken: { token: Address; wins: number; losses: number; draws: number; volume: string; payoutWon: string; net: string }[];
};

export type OpenDuelFilters = {
  game?: Game;
  token?: Address;
  minAmount?: bigint;
  maxAmount?: bigint;
  sort: "newest" | "amount";
};

export async function fetchIndexer<T>(path: string): Promise<T> {
  const res = await fetch(appConfig().indexerUrl + path);
  if (!res.ok) throw new Error(`Indexer error ${res.status}`);
  return (await res.json()) as T;
}

const LIVE = 3_000;

export function useOpenDuels(filters: OpenDuelFilters) {
  const q = new URLSearchParams({ sort: filters.sort, limit: "60" });
  if (filters.game) q.set("game", filters.game);
  if (filters.token) q.set("token", filters.token);
  if (filters.minAmount !== undefined) q.set("minAmount", filters.minAmount.toString());
  if (filters.maxAmount !== undefined) q.set("maxAmount", filters.maxAmount.toString());
  return useQuery({
    queryKey: ["indexer", "open", q.toString()],
    queryFn: () => fetchIndexer<{ items: IndexerDuel[] }>(`/duels/open?${q}`).then((r) => r.items),
    refetchInterval: LIVE,
  });
}

export function useRecentResults() {
  return useQuery({
    queryKey: ["indexer", "recent"],
    queryFn: () => fetchIndexer<{ items: IndexerDuel[] }>("/results/recent?limit=20").then((r) => r.items),
    refetchInterval: LIVE,
  });
}

/** Satu duel dari indexer, atau null jika belum terindeks (indexer bisa tertinggal beberapa detik). */
export function useIndexedDuel(id: bigint | undefined) {
  return useQuery({
    queryKey: ["indexer", "duel", id?.toString()],
    queryFn: () => fetchIndexer<{ items: IndexerDuel[] }>(`/duels?ids=${id}`).then((r) => r.items[0] ?? null),
    enabled: id !== undefined,
    refetchInterval: 2_000,
  });
}

export function usePlayerDuels(address: Address | undefined) {
  return useQuery({
    queryKey: ["indexer", "player-duels", address],
    queryFn: () => fetchIndexer<{ items: IndexerDuel[] }>(`/players/${address}/duels?limit=100`).then((r) => r.items),
    enabled: !!address,
    refetchInterval: LIVE,
  });
}

export function usePlayerStats(address: Address | undefined) {
  return useQuery({
    queryKey: ["indexer", "player-stats", address],
    queryFn: () => fetchIndexer<PlayerStats>(`/players/${address}/stats`),
    enabled: !!address,
    refetchInterval: LIVE,
  });
}

export function usePendingReveals(address: Address | undefined) {
  return useQuery({
    queryKey: ["indexer", "pending-reveals", address],
    queryFn: () =>
      fetchIndexer<{ items: (IndexerDuel & { expired: boolean })[] }>(`/players/${address}/pending-reveals`).then(
        (r) => r.items,
      ),
    enabled: !!address,
    refetchInterval: LIVE,
  });
}

export type GlobalStats = {
  totalDuels: number;
  byToken: { token: Address; duels: number; matched: number; volume: string; fees: string }[];
  byGame: Partial<Record<Game, number>>;
  byStatus: Partial<Record<Status, number>>;
};

/** Statistik global untuk hero Lobby. */
export function useGlobalStats() {
  return useQuery({
    queryKey: ["indexer", "stats"],
    queryFn: () => fetchIndexer<GlobalStats>("/stats"),
    refetchInterval: 10_000,
  });
}
