/**
 * `pnpm dev` — chain lokal + auto-fulfill + indexer dalam satu perintah.
 *
 *   1. scripts/dev-chain     Anvil + deploy + isi akun test → deployments/local.json
 *   2. scripts/auto-fulfill  memenuhi request DevRandomnessProvider
 *   3. indexer (Ponder)      INDEXER_CHAIN=local, http://localhost:INDEXER_PORT
 *
 * Ctrl+C menghentikan semuanya. Chain dimulai dari nol setiap kali, jadi database indexer juga direset.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { startDevChain } from "./dev-chain/index.ts";
import { startAutoFulfill } from "./auto-fulfill/index.ts";
import { INDEXER_DIR, envInt, loadRootEnv } from "./lib/env.ts";
import { logger, pipeLines } from "./lib/log.ts";

const log = logger("dev");

async function main(): Promise<void> {
  loadRootEnv();
  const indexerPort = envInt("INDEXER_PORT", 42069);

  const chain = await startDevChain();
  const fulfill = await startAutoFulfill().catch((err: unknown) => {
    chain.stop();
    throw err;
  });

  // Chain baru → data indexer lama tidak berlaku lagi.
  rmSync(join(INDEXER_DIR, ".ponder"), { recursive: true, force: true });
  const indexer: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@rivl/indexer", "exec", "ponder", "dev", "--disable-ui", "--port", String(indexerPort)],
    {
      cwd: join(INDEXER_DIR, ".."),
      env: { ...process.env, INDEXER_CHAIN: "local", FORCE_COLOR: "0", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  pipeLines(indexer.stdout!, "indexer");
  pipeLines(indexer.stderr!, "indexer", console.error);

  let shuttingDown = false;
  const shutdown = (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    fulfill.stop();
    indexer.kill("SIGTERM");
    chain.stop();
    setTimeout(() => process.exit(code), 500);
  };
  indexer.on("exit", (code) => {
    if (!shuttingDown) {
      log.error(`indexer berhenti (code ${code})`);
      shutdown(1);
    }
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => shutdown(0));

  const d = chain.deployment;
  log.info("──────────────────────────────────────────────────────────");
  log.info(`RPC        ${d.rpcUrl}  (chain ID ${d.chainId})`);
  log.info(`DuelArena  ${d.contracts.arena}`);
  log.info(`USDG mock  ${d.contracts.usdg}`);
  log.info(`Indexer    http://localhost:${indexerPort}  (/duels/open, /stats, /graphql, …)`);
  log.info("Main duel contoh: pnpm demo   ·   Ctrl+C untuk berhenti");
  log.info("──────────────────────────────────────────────────────────");
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
