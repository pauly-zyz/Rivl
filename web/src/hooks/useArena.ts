"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, zeroAddress, type Address } from "viem";
import { useBlock, useReadContracts } from "wagmi";

import { appConfig } from "@/lib/config";

export type TokenInfo = {
  address: Address;
  symbol: string;
  decimals: number;
  isEth: boolean;
  allowed: boolean;
  minStake: bigint;
  maxStake: bigint;
};

/**
 * ETH + USDG beserta desimal (dibaca dari contract token, tidak diasumsikan),
 * tokenConfig (batas taruhan), dan feeBps saat ini.
 */
export function useArenaInfo() {
  const { arena, usdg } = appConfig();
  // Alamat placeholder hanya agar bentuk query tetap; query USDG dimatikan jika USDG tidak dikonfigurasi.
  const usdgAddr = usdg ?? zeroAddress;

  const arenaReads = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: arena, abi: duelArenaAbi, functionName: "feeBps" },
      { address: arena, abi: duelArenaAbi, functionName: "paused" },
      { address: arena, abi: duelArenaAbi, functionName: "tokenConfig", args: [zeroAddress] },
      { address: arena, abi: duelArenaAbi, functionName: "tokenConfig", args: [usdgAddr] },
    ],
    query: { refetchInterval: 30_000 },
  });
  const usdgReads = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: usdgAddr, abi: erc20Abi, functionName: "decimals" },
      { address: usdgAddr, abi: erc20Abi, functionName: "symbol" },
    ],
    query: { enabled: !!usdg, staleTime: Infinity },
  });

  const isLoading = arenaReads.isLoading || (!!usdg && usdgReads.isLoading);
  const error = arenaReads.error ?? usdgReads.error;

  return useMemo(() => {
    if (!arenaReads.data) return { tokens: [] as TokenInfo[], feeBps: undefined, paused: false, isLoading, error };
    const [feeBps, paused, ethCfg, usdgCfg] = arenaReads.data;
    const tokens: TokenInfo[] = [
      { address: zeroAddress, symbol: "ETH", decimals: 18, isEth: true, allowed: ethCfg[0], minStake: ethCfg[1], maxStake: ethCfg[2] },
    ];
    if (usdg && usdgReads.data) {
      const [decimals, symbol] = usdgReads.data;
      tokens.push({ address: usdg, symbol, decimals, isEth: false, allowed: usdgCfg[0], minStake: usdgCfg[1], maxStake: usdgCfg[2] });
    }
    return { tokens, feeBps, paused, isLoading, error };
  }, [arenaReads.data, usdgReads.data, usdg, isLoading, error]);
}

export function findToken(tokens: TokenInfo[], address: string | null | undefined): TokenInfo | undefined {
  return tokens.find((t) => t.address.toLowerCase() === address?.toLowerCase());
}

/**
 * Waktu sekarang (detik) = max(jam dinding, timestamp blok terakhir).
 * Di chain lokal yang waktunya dimajukan, timestamp blok lebih besar dari jam dinding.
 * Bernilai undefined sebelum komponen ter-mount (menghindari hydration mismatch).
 */
export function useNow(): number | undefined {
  const { data: block } = useBlock({ watch: true, query: { refetchInterval: 5_000 } });
  const [wall, setWall] = useState<number>();
  useEffect(() => {
    const tick = () => setWall(Math.floor(Date.now() / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  if (wall === undefined) return undefined;
  return Math.max(wall, Number(block?.timestamp ?? 0));
}
