"use client";

import { erc20Abi } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";

import { appConfig } from "@/lib/config";
import type { TokenInfo } from "./useArena";

/** Saldo pengguna dan allowance ke arena untuk satu token taruhan. */
export function useStake(token: TokenInfo | undefined, amount: bigint | undefined) {
  const { address } = useAccount();
  const { arena } = appConfig();
  const isErc20 = !!token && !token.isEth;

  const eth = useBalance({ address, query: { enabled: !!address && token?.isEth } });
  const erc20Balance = useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && isErc20 },
  });
  const allowance = useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, arena] : undefined,
    query: { enabled: !!address && isErc20 },
  });

  const balance = token?.isEth ? eth.data?.value : (erc20Balance.data as bigint | undefined);
  const needsApproval =
    isErc20 && amount !== undefined && amount > 0n && ((allowance.data as bigint | undefined) ?? 0n) < amount;

  return {
    balance,
    needsApproval,
    insufficient: balance !== undefined && amount !== undefined && amount > balance,
    approveCall: () => ({
      address: token!.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [arena, amount!] as const,
    }),
  };
}
