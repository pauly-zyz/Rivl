"use client";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress, type Address, type Hex } from "viem";

import { diceRolls, GAMES, potBreakdown, sameAddress, STATUSES } from "./duel";
import type { IndexerDuel } from "./indexer";

/*
 * Jalur cepat: duel terbaru langsung dari contract (lewat /api/live), digabung dengan data indexer.
 * Indexer tetap sumber riwayat lengkap dan hash transaksi; data chain menang untuk status terkini, jadi duel baru,
 * join, cancel, dan hasil tampil dalam ±1–2 detik walaupun indexer tertinggal.
 */

type RawDuel = Record<string, string | number | boolean>;
type LiveResponse = { nextId: string; now: string; duels: RawDuel[] };

const ZERO_HASH = `0x${"0".repeat(64)}`;
const str = (v: unknown) => String(v);
const orNull = (a: unknown) => (typeof a === "string" && a.toLowerCase() !== zeroAddress ? (a.toLowerCase() as Address) : null);

/** Ubah struct getDuel() menjadi bentuk baris indexer (kolom yang hanya diketahui indexer = null). */
export function liveToIndexer(d: RawDuel): IndexerDuel {
  const game = GAMES[Number(d.game)] ?? "Coinflip";
  const status = STATUSES[Number(d.status)] ?? "None";
  const joined = orNull(d.joiner) !== null;
  const salt = String(d.salt).toLowerCase();
  const revealed = salt !== ZERO_HASH;
  const randomWord = BigInt(str(d.randomWord));
  const hasRandom = game !== "Suit" && revealed && randomWord !== 0n;
  const settled = status === "Settled";
  const { fee, payout } = potBreakdown(BigInt(str(d.amount)), Number(d.feeBpsAtCreate));
  const rolls = hasRandom && game === "Dice" ? diceRolls(randomWord) : undefined;
  return {
    id: str(d.id),
    game,
    token: String(d.token).toLowerCase() as Address,
    amount: str(d.amount),
    creator: String(d.creator).toLowerCase() as Address,
    creatorChoice: game === "Coinflip" ? Number(d.creatorChoice) : null,
    commit: String(d.commit) as Hex,
    createdAt: str(d.createdAt),
    expiresAt: str(d.expiresAt),
    createdTx: "" as Hex,
    joiner: orNull(d.joiner),
    joinerChoice: game === "Suit" && joined ? Number(d.joinerChoice) : null,
    joinedAt: joined ? str(d.joinedAt) : null,
    deadline: joined ? str(d.deadline) : null,
    joinedTx: null,
    joinerSeed: game !== "Suit" && joined ? (String(d.joinerSeed) as Hex) : null,
    revealedMove: revealed ? (game === "Suit" ? Number(d.creatorChoice) : 0) : null,
    revealedSalt: revealed ? (salt as Hex) : null,
    revealTx: null,
    status,
    winner: orNull(d.winner),
    payout: settled ? payout.toString() : null,
    fee: settled ? fee.toString() : null,
    randomWord: hasRandom ? randomWord.toString() : null,
    settledAt: null,
    settledTx: null,
    coinResult: hasRandom && game === "Coinflip" ? Number(d.creatorResult) : null,
    creatorRoll: rolls ? rolls.creator : null,
    joinerRoll: rolls ? rolls.joiner : null,
    revealTimedOut: settled && !revealed,
  };
}

export type LiveDuels = { now: number; byId: Map<string, IndexerDuel>; list: IndexerDuel[] };

/** Duel terbaru dari chain, diperbarui tiap ±1,5 detik (satu query bersama untuk seluruh halaman). */
export function useLiveDuels() {
  return useQuery({
    queryKey: ["live-duels"],
    refetchInterval: 1_500,
    staleTime: 1_000,
    retry: false,
    queryFn: async (): Promise<LiveDuels> => {
      const res = await fetch("/api/live");
      if (!res.ok) throw new Error(`Live reader error ${res.status}`);
      const body = (await res.json()) as LiveResponse;
      const list = body.duels.map(liveToIndexer);
      return { now: Number(body.now), list, byId: new Map(list.map((d) => [d.id, d])) };
    },
  });
}

/**
 * Gabungkan daftar indexer dengan data chain terbaru.
 * - Duel yang ada di keduanya: status/kolom dari chain, hash transaksi dan waktu dari indexer.
 * - Duel yang hanya ada di chain dan lolos `keep`: ditambahkan.
 * - Duel dari indexer yang menurut chain tidak lagi lolos `keep`: dibuang.
 */
export function mergeLive(
  indexed: IndexerDuel[] | undefined,
  live: LiveDuels | undefined,
  keep: (d: IndexerDuel, now: number) => boolean,
): IndexerDuel[] | undefined {
  if (!live) return indexed;
  if (!indexed) return undefined;
  const now = live.now;
  const seen = new Set<string>();
  const out: IndexerDuel[] = [];
  for (const d of indexed) {
    seen.add(d.id);
    const fresh = live.byId.get(d.id);
    const merged = fresh
      ? {
          ...fresh,
          createdTx: d.createdTx,
          joinedTx: d.joinedTx ?? fresh.joinedTx,
          revealTx: d.revealTx ?? fresh.revealTx,
          settledTx: d.settledTx ?? fresh.settledTx,
          settledAt: d.settledAt ?? fresh.settledAt,
        }
      : d;
    if (keep(merged, now)) out.push(merged);
  }
  for (const d of live.list) if (!seen.has(d.id) && keep(d, now)) out.push(d);
  return out;
}

export const isParticipant = (d: IndexerDuel, address: string | undefined) =>
  sameAddress(d.creator, address) || sameAddress(d.joiner, address);
