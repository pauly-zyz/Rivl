import { defineChain, getAddress, isAddress, type Address, type Chain } from "viem";

/**
 * Semua konfigurasi chain berasal dari variabel NEXT_PUBLIC_* (docs/spec.md bagian 5.1 dan 6).
 * Tidak ada chain ID, RPC, atau alamat bawaan: untuk lokal, `pnpm dev` mengisinya dari deployments/local.json.
 * process.env.NEXT_PUBLIC_* harus ditulis lengkap supaya Next.js bisa meng-inline nilainya.
 */
const raw = {
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_CHAIN_NAME: process.env.NEXT_PUBLIC_CHAIN_NAME,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
  NEXT_PUBLIC_ARENA_ADDRESS: process.env.NEXT_PUBLIC_ARENA_ADDRESS,
  NEXT_PUBLIC_USDG_ADDRESS: process.env.NEXT_PUBLIC_USDG_ADDRESS,
  NEXT_PUBLIC_INDEXER_URL: process.env.NEXT_PUBLIC_INDEXER_URL,
  NEXT_PUBLIC_X_URL: process.env.NEXT_PUBLIC_X_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
};

export type AppConfig = {
  chain: Chain;
  rpcUrl: string;
  explorerUrl?: string;
  arena: Address;
  usdg?: Address;
  indexerUrl: string;
  xUrl?: string;
  walletConnectProjectId?: string;
};

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; missing: string[] };

const val = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

function load(): ConfigResult {
  const missing: string[] = [];
  const chainIdRaw = val(raw.NEXT_PUBLIC_CHAIN_ID);
  const chainId = Number(chainIdRaw);
  if (!chainIdRaw || !Number.isSafeInteger(chainId) || chainId <= 0) missing.push("NEXT_PUBLIC_CHAIN_ID");
  const rpcUrl = val(raw.NEXT_PUBLIC_RPC_URL);
  if (!rpcUrl) missing.push("NEXT_PUBLIC_RPC_URL");
  const arena = val(raw.NEXT_PUBLIC_ARENA_ADDRESS);
  if (!arena || !isAddress(arena)) missing.push("NEXT_PUBLIC_ARENA_ADDRESS");
  const indexerUrl = val(raw.NEXT_PUBLIC_INDEXER_URL);
  if (!indexerUrl) missing.push("NEXT_PUBLIC_INDEXER_URL");
  const usdg = val(raw.NEXT_PUBLIC_USDG_ADDRESS);
  if (usdg && !isAddress(usdg)) missing.push("NEXT_PUBLIC_USDG_ADDRESS (not a valid address)");
  if (missing.length) return { ok: false, missing };

  const explorerUrl = val(raw.NEXT_PUBLIC_EXPLORER_URL)?.replace(/\/+$/, "");
  const chain = defineChain({
    id: chainId,
    name: val(raw.NEXT_PUBLIC_CHAIN_NAME) ?? "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl!] } },
    ...(explorerUrl ? { blockExplorers: { default: { name: "Explorer", url: explorerUrl } } } : {}),
  });

  return {
    ok: true,
    config: {
      chain,
      rpcUrl: rpcUrl!,
      explorerUrl,
      arena: getAddress(arena!),
      usdg: usdg ? getAddress(usdg) : undefined,
      indexerUrl: indexerUrl!.replace(/\/+$/, ""),
      xUrl: val(raw.NEXT_PUBLIC_X_URL),
      walletConnectProjectId: val(raw.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
    },
  };
}

export const configResult = load();

/** Hanya dipanggil di bawah <Providers>, yang sudah memastikan konfigurasi valid. */
export function appConfig(): AppConfig {
  if (!configResult.ok) throw new Error(`Missing config: ${configResult.missing.join(", ")}`);
  return configResult.config;
}

export function explorerTx(hash: string): string | undefined {
  const url = configResult.ok ? configResult.config.explorerUrl : undefined;
  return url ? `${url}/tx/${hash}` : undefined;
}

export function explorerAddress(address: string): string | undefined {
  const url = configResult.ok ? configResult.config.explorerUrl : undefined;
  return url ? `${url}/address/${address}` : undefined;
}
