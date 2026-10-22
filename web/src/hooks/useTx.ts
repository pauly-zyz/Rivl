"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Abi, Address, Hash, TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";

import { appConfig } from "@/lib/config";
import { friendlyError } from "@/lib/errors";

export type ContractCall = {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export type TxState =
  | { status: "idle" }
  | { status: "wallet"; label: string }
  | { status: "pending"; label: string; hash: Hash }
  | { status: "success"; label: string; hash: Hash }
  | { status: "error"; label: string; error: string };

/**
 * Kirim transaksi: simulasi dulu (error revert yang jelas), minta tanda tangan, tunggu konfirmasi,
 * lalu refresh semua data. Status selalu mengikuti chain: "success" hanya setelah receipt sukses.
 */
export function useTx() {
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const send = useCallback(
    async (label: string, call: ContractCall): Promise<TransactionReceipt> => {
      if (!address || !client) throw new Error("Connect your wallet first.");
      try {
        setState({ status: "wallet", label });
        const target = appConfig().chain.id;
        if (chainId !== target) await switchChainAsync({ chainId: target });

        const { request } = await client.simulateContract({ ...call, account: address } as never);
        const hash = await writeContractAsync(request as never);
        setState({ status: "pending", label, hash });

        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted on chain.");
        setState({ status: "success", label, hash });
        await queryClient.invalidateQueries();
        return receipt;
      } catch (err) {
        setState({ status: "error", label, error: friendlyError(err) });
        throw err;
      }
    },
    [address, chainId, client, queryClient, switchChainAsync, writeContractAsync],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { send, state, reset, busy: state.status === "wallet" || state.status === "pending" };
}
