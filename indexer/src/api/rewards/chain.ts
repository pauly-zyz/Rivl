import { createPublicClient, defineChain, http, parseAbi, parseAbiItem } from "viem";

import { rewardsEnv } from "./env";

export const erc20 = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export const ownerAbi = parseAbi(["function owner() view returns (address)"]);

const chain = defineChain({
  id: rewardsEnv.chainId || 1,
  name: "rivl",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rewardsEnv.rpc || "http://127.0.0.1:8545"] } },
});

export const client = createPublicClient({ chain, transport: http(undefined, { retryCount: 2, timeout: 20_000 }) });

let tokenMeta: Promise<{ decimals: number; symbol: string }> | undefined;
export function rivlMeta() {
  if (!rewardsEnv.rivl) return Promise.resolve({ decimals: 18, symbol: "RIVL" });
  tokenMeta ??= Promise.all([
    client.readContract({ address: rewardsEnv.rivl, abi: erc20, functionName: "decimals" }),
    client.readContract({ address: rewardsEnv.rivl, abi: erc20, functionName: "symbol" }).catch(() => "RIVL"),
  ])
    .then(([decimals, symbol]) => ({ decimals: Number(decimals), symbol }))
    .catch((err) => {
      tokenMeta = undefined;
      throw err;
    });
  return tokenMeta;
}
