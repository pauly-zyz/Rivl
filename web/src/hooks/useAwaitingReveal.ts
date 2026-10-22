"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";

import { appConfig } from "@/lib/config";
import { usePendingReveals } from "@/lib/indexer";

/**
 * Duel Suit milik `address` yang masih menunggu reveal.
 * Daftar kandidat dari indexer, lalu dicocokkan dengan status di chain: indexer bisa tertinggal beberapa
 * detik, dan tanpa pengecekan ini duel yang baru di-reveal masih tampil sebagai "You need to reveal".
 */
export function useAwaitingReveal(address: Address | undefined) {
  const { data } = usePendingReveals(address);
  const client = usePublicClient();
  const ids = (data ?? []).map((d) => d.id);

  const { data: onChain } = useQuery({
    queryKey: ["chain", "awaiting-reveal", ids.join(",")],
    enabled: ids.length > 0 && !!client,
    refetchInterval: 3_000,
    queryFn: async () => {
      const duels = await Promise.all(
        ids.map((id) =>
          client!.readContract({ address: appConfig().arena, abi: duelArenaAbi, functionName: "getDuel", args: [BigInt(id)] }),
        ),
      );
      return new Set(ids.filter((_, i) => duels[i]!.status === 3)); // 3 = AwaitingReveal
    },
  });

  return (data ?? []).filter((d) => onChain?.has(d.id));
}
