"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";

import { appConfig } from "./config";
import { isParticipant, mergeLive, useLiveDuels } from "./live";
import { sameAddress, type Game, type Status } from "./duel";

/** Baris tabel `duel` dari indexer (indexer/ponder.schema.ts). Bilangan uint dikirim sebagai string. */
export type IndexerDuel = {
  id: string;
  game: Game;
  token: Address;
  amount: string;
  creator: Address;
  creatorChoice: number | null;
  commit: Hex;
  createdAt: string;
  expiresAt: string;
  createdTx: Hex;
  joiner: Address | null;
  joinerChoice: number | null;
  joinedAt: string | null;
  deadline: string | null;
  joinedTx: Hex | null;
  joinerSeed: Hex | null;
  revealedMove: number | null;
  revealedSalt: Hex | null;
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

/** Gabungan indexer + chain terbaru (lib/live.ts). Jika indexer belum/tidak menjawab, data chain tetap tampil. */
function withLive<T extends { data?: IndexerDuel[] }>(
  query: T,
  live: ReturnType<typeof useLiveDuels>["data"],
  keep: (d: IndexerDuel, now: number) => boolean,
  sort: (a: IndexerDuel, b: IndexerDuel) => number,
  limit?: number,
): T {
  const merged = mergeLive(query.data ?? (live ? [] : undefined), live, keep);
  const data = merged?.sort(sort).slice(0, limit);
  return { ...query, data, isLoading: data === undefined && (query as { isLoading?: boolean }).isLoading } as T;
}

const big = (v: string | null | undefined) => BigInt(v ?? 0);
const byNewest = (a: IndexerDuel, b: IndexerDuel) => Number(big(b.createdAt) - big(a.createdAt)) || Number(big(b.id) - big(a.id));

export function useOpenDuels(filters: OpenDuelFilters) {
  const q = new URLSearchParams({ sort: filters.sort, limit: "60" });
  if (filters.game) q.set("game", filters.game);
  if (filters.token) q.set("token", filters.token);
  if (filters.minAmount !== undefined) q.set("minAmount", filters.minAmount.toString());
  if (filters.maxAmount !== undefined) q.set("maxAmount", filters.maxAmount.toString());
  const query = useQuery({
    queryKey: ["indexer", "open", q.toString()],
    queryFn: () => fetchIndexer<{ items: IndexerDuel[] }>(`/duels/open?${q}`).then((r) => r.items),
    refetchInterval: LIVE,
  });
  const { data: live } = useLiveDuels();
  return withLive(
    query,
    live,
    (d, now) =>
      d.status === "Open" &&
      Number(d.expiresAt) > now &&
      (!filters.game || d.game === filters.game) &&
      (!filters.token || d.token.toLowerCase() === filters.token.toLowerCase()) &&
      (filters.minAmount === undefined || BigInt(d.amount) >= filters.minAmount) &&
      (filters.maxAmount === undefined || BigInt(d.amount) <= filters.maxAmount),
    filters.sort === "amount" ? (a, b) => Number(big(b.amount) - big(a.amount)) || Number(big(b.id) - big(a.id)) : byNewest,
    60,
  );
}

export function useRecentResults() {
  const query = useQuery({
    queryKey: ["indexer", "recent"],
    queryFn: () => fetchIndexer<{ items: IndexerDuel[] }>("/results/recent?limit=20").then((r) => r.items),
    refetchInterval: LIVE,
  });
  const { data: live } = useLiveDuels();
  // Hasil yang baru saja selesai belum punya settledAt dari indexer: tampil paling atas, urut ID terbaru.
  return withLive(
    query,
    live,
    (d) => d.status === "Settled" || d.status === "Draw",
    (a, b) =>
      (a.settledAt === null ? 1 : 0) !== (b.settledAt === null ? 1 : 0)
        ? (a.settledAt === null ? -1 : 1)
        : Number(big(b.settledAt) - big(a.settledAt)) || Number(big(b.id) - big(a.id)),
    20,
  );
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
  const query = useQuery({
    queryKey: ["indexer", "player-duels", address],
    queryFn: () => fetchIndexer<{ items: IndexerDuel[] }>(`/players/${address}/duels?limit=100`).then((r) => r.items),
    enabled: !!address,
    refetchInterval: LIVE,
  });
  const { data: live } = useLiveDuels();
  return withLive(query, address ? live : undefined, (d) => isParticipant(d, address), byNewest, 100);
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
  const query = useQuery({
    queryKey: ["indexer", "pending-reveals", address],
    queryFn: () =>
      fetchIndexer<{ items: (IndexerDuel & { expired: boolean })[] }>(`/players/${address}/pending-reveals`).then(
        (r) => r.items,
      ),
    enabled: !!address,
    refetchInterval: LIVE,
  });
  const { data: live } = useLiveDuels();
  const merged = withLive(
    query as unknown as { data?: IndexerDuel[] },
    address ? live : undefined,
    (d) => d.status === "AwaitingReveal" && sameAddress(d.creator, address),
    (a, b) => Number(big(a.deadline) - big(b.deadline)),
  );
  const now = live?.now;
  return {
    ...query,
    data: merged.data?.map((d) => ({ ...d, expired: now !== undefined && d.deadline !== null && Number(d.deadline) < now })),
  };
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
