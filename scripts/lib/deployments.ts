import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address } from "viem";

import { REPO_ROOT } from "./env.ts";

/** Ditulis oleh scripts/dev-chain, dibaca indexer (INDEXER_CHAIN=local), demo, dan e2e. */
export const LOCAL_DEPLOYMENT_FILE = join(REPO_ROOT, "deployments", "local.json");

export type LocalDeployment = {
  chainId: number;
  rpcUrl: string;
  startBlock: number;
  deployedAt: string;
  owner: Address;
  treasury: Address;
  contracts: {
    arena: Address;
    usdg: Address;
  };
  usdgDecimals: number;
  testAccounts: Address[];
};

export function writeLocalDeployment(d: LocalDeployment): void {
  mkdirSync(dirname(LOCAL_DEPLOYMENT_FILE), { recursive: true });
  writeFileSync(LOCAL_DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + "\n");
}

export function readLocalDeployment(): LocalDeployment {
  if (!existsSync(LOCAL_DEPLOYMENT_FILE)) {
    throw new Error(`${LOCAL_DEPLOYMENT_FILE} tidak ada. Jalankan chain lokal dulu: pnpm dev (atau pnpm dev:chain).`);
  }
  return JSON.parse(readFileSync(LOCAL_DEPLOYMENT_FILE, "utf8")) as LocalDeployment;
}
