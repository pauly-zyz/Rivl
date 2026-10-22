import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Satu .env di root repo. Variabel yang sudah di-set (mis. oleh `pnpm dev` untuk chain lokal) tidak ditimpa.
const rootEnv = join(repoRoot, ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const PUBLIC_VARS = [
  "NEXT_PUBLIC_CHAIN_ID",
  "NEXT_PUBLIC_CHAIN_NAME",
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_EXPLORER_URL",
  "NEXT_PUBLIC_ARENA_ADDRESS",
  "NEXT_PUBLIC_USDG_ADDRESS",
  "NEXT_PUBLIC_INDEXER_URL",
  "NEXT_PUBLIC_X_URL",
  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
] as const;

const nextConfig: NextConfig = {
  // ABI dan test vector diimpor sebagai TypeScript/JSON dari paket workspace.
  transpilePackages: ["@rivl/contracts"],
  // Konektor Base Account (wagmi) memuat @base-org/account lewat import() dinamis. Entri Node-nya menarik
  // @coinbase/cdp-sdk yang butuh paket opsional @x402/*. Jangan bundle di server; konektor itu tidak dipakai.
  serverExternalPackages: ["@base-org/account", "@coinbase/cdp-sdk"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  env: Object.fromEntries(PUBLIC_VARS.map((k) => [k, process.env[k] ?? ""])),
  reactStrictMode: true,
};

export default nextConfig;
